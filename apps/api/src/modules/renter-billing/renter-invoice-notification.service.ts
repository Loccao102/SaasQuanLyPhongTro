import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import { CommercialPolicyService } from "../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../database/database.service.js";
import { AccessControlService } from "../identity/access-control.service.js";
import type { TenantPrincipal } from "../identity/tenant-principal.js";
import { NotificationCampaignService } from "../notifications/application/notification-campaign.service.js";
import { RenterPublicInvoiceService } from "./renter-public-invoice.service.js";

type CycleRow = QueryResultRow & {
  id: string;
  cycle_code: string;
  property_id: string;
  property_name: string;
  due_date: Date | string;
  status: "OPEN" | "FINALIZED" | "CANCELLED";
  operational_group_ids: string[];
};

type CandidateRow = QueryResultRow & {
  invoice_id: string;
  invoice_number: string;
  room_code: string;
  remaining_vnd: string;
  due_date: Date | string;
  resident_name: string | null;
  phone: string | null;
};

type GroupedInvoice = {
  invoiceId: string;
  invoiceNumber: string;
  roomCode: string;
  remainingVnd: number;
  dueDate: string;
  publicUrl: string;
};

@Injectable()
export class RenterInvoiceNotificationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly accessControl: AccessControlService,
    private readonly commercialPolicy: CommercialPolicyService,
    private readonly campaigns: NotificationCampaignService,
    private readonly publicInvoices: RenterPublicInvoiceService
  ) {}

  async createCycleCampaign(
    principal: TenantPrincipal,
    cycleId: string,
    idempotencyKey: string
  ) {
    return this.db.withTransaction(async (client) => {
      const cycle = await this.requireCycle(client, principal, cycleId);

      const replayed =
        await this.campaigns.replaySourceInTransaction(client, {
          organizationId: principal.organizationId,
          idempotencyKey,
          sourceType: "RENTER_BILLING_CYCLE",
          sourceId: cycleId
        });

      if (replayed) {
        const counts = await this.candidateCounts(
          client,
          principal.organizationId,
          cycleId
        );
        return {
          replayed: true,
          campaign: replayed,
          invoiceCount: counts.eligible,
          recipientCount: replayed.totalRecipients,
          skippedInvoiceCount: counts.missingContact
        };
      }

      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      const candidates = await this.candidates(
        client,
        principal.organizationId,
        cycleId
      );
      const eligible = candidates.filter((item) => item.phone?.trim());
      const skippedInvoiceCount = candidates.length - eligible.length;

      if (eligible.length === 0) {
        throw new ConflictException(
          "No outstanding issued invoices have a primary tenant phone number."
        );
      }

      const baseUrl = this.publicInvoiceBaseUrl();
      const groups = new Map<
        string,
        { displayName: string | null; invoices: GroupedInvoice[] }
      >();

      for (const item of eligible) {
        const phone = item.phone!.trim();
        const link = await this.publicInvoices.issueAccessInTransaction(
          client,
          principal,
          item.invoice_id
        );
        const bucket = groups.get(phone) ?? {
          displayName: item.resident_name?.trim() || null,
          invoices: []
        };
        bucket.invoices.push({
          invoiceId: item.invoice_id,
          invoiceNumber: item.invoice_number,
          roomCode: item.room_code,
          remainingVnd: Number(item.remaining_vnd),
          dueDate: this.dateOnly(item.due_date),
          publicUrl:
            baseUrl + "/i/" + encodeURIComponent(link.token)
        });
        groups.set(phone, bucket);
      }

      const recipients = Array.from(groups.entries()).map(
        ([recipientKey, group]) => ({
          recipientKey,
          recipientDisplayName: group.displayName,
          messageBodyOverride: this.message(
            cycle.cycle_code,
            group.displayName,
            group.invoices
          )
        })
      );

      const campaign = await this.campaigns.createInTransaction(client, {
        actor: {
          userId: principal.userId,
          membership: principal.membership
        },
        organizationId: principal.organizationId,
        idempotencyKey,
        channel: "ZALO",
        provider: "PLAYWRIGHT_ZALO",
        messageBody:
          "Habi gửi hóa đơn " + cycle.cycle_code + ".",
        sourceType: "RENTER_BILLING_CYCLE",
        sourceId: cycleId,
        recipients
      });

      await client.query(
        `INSERT INTO audit_events (
           organization_id,
           actor_user_id,
           action,
           resource_type,
           resource_id,
           metadata
         )
         VALUES (
           $1, $2, 'RENTER_INVOICE_NOTIFICATION_CAMPAIGN_CREATED',
           'RENTER_BILLING_CYCLE', $3, $4::jsonb
         )`,
        [
          principal.organizationId,
          principal.userId,
          cycleId,
          JSON.stringify({
            campaignId: campaign.id,
            invoiceCount: eligible.length,
            recipientCount: recipients.length,
            skippedInvoiceCount,
            linksRotated: eligible.length
          })
        ]
      );

      return {
        replayed: false,
        campaign,
        invoiceCount: eligible.length,
        recipientCount: recipients.length,
        skippedInvoiceCount
      };
    });
  }

  private async requireCycle(
    client: PoolClient,
    principal: TenantPrincipal,
    cycleId: string
  ): Promise<CycleRow> {
    const result = await client.query<CycleRow>(
      `SELECT
         c.id::text,
         c.cycle_code,
         c.property_id::text,
         p.name AS property_name,
         c.due_date,
         c.status,
         COALESCE(
           array_agg(DISTINCT pog.operational_group_id::text)
             FILTER (WHERE pog.operational_group_id IS NOT NULL),
           '{}'::text[]
         ) AS operational_group_ids
       FROM renter_billing_cycles c
       JOIN properties p
         ON p.organization_id = c.organization_id
        AND p.id = c.property_id
       LEFT JOIN property_operational_groups pog
         ON pog.organization_id = c.organization_id
        AND pog.property_id = c.property_id
       WHERE c.organization_id = $1::uuid
         AND c.id = $2::uuid
       GROUP BY c.id, p.name
       FOR UPDATE OF c`,
      [principal.organizationId, cycleId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException("Renter billing cycle was not found.");
    }
    if (row.status !== "FINALIZED") {
      throw new ConflictException(
        "Invoice notification campaign requires a FINALIZED billing cycle."
      );
    }

    const resource = {
      organizationId: principal.organizationId,
      propertyId: row.property_id,
      operationalGroupIds: row.operational_group_ids
    };
    if (
      !this.accessControl.can(
        principal.membership,
        "billing.manage",
        resource
      ) ||
      !this.accessControl.can(
        principal.membership,
        "notification.send",
        resource
      )
    ) {
      throw new ForbiddenException(
        "Billing manage and notification send permissions are required."
      );
    }

    return row;
  }

  private async candidates(
    client: PoolClient,
    organizationId: string,
    cycleId: string
  ): Promise<CandidateRow[]> {
    const result = await client.query<CandidateRow>(
      `SELECT
         i.id::text AS invoice_id,
         i.invoice_number,
         i.room_code_snapshot AS room_code,
         i.remaining_vnd::text,
         i.due_date,
         contact.full_name AS resident_name,
         contact.phone
       FROM renter_invoices i
       LEFT JOIN LATERAL (
         SELECT r.full_name, r.phone
         FROM lease_residents lr
         JOIN residents r
           ON r.organization_id = lr.organization_id
          AND r.id = lr.resident_id
         WHERE lr.organization_id = i.organization_id
           AND lr.lease_id = i.lease_id
           AND lr.party_role = 'PRIMARY_TENANT'
         ORDER BY
           (lr.left_on IS NULL) DESC,
           lr.joined_on DESC,
           lr.resident_id
         LIMIT 1
       ) contact ON true
       WHERE i.organization_id = $1::uuid
         AND i.billing_cycle_id = $2::uuid
         AND i.status = 'ISSUED'
         AND i.remaining_vnd > 0
       ORDER BY i.room_code_snapshot, i.id`,
      [organizationId, cycleId]
    );
    return result.rows;
  }

  private async candidateCounts(
    client: PoolClient,
    organizationId: string,
    cycleId: string
  ) {
    const rows = await this.candidates(client, organizationId, cycleId);
    return {
      eligible: rows.filter((item) => item.phone?.trim()).length,
      missingContact: rows.filter((item) => !item.phone?.trim()).length
    };
  }

  private publicInvoiceBaseUrl(): string {
    const raw =
      process.env.PUBLIC_INVOICE_BASE_URL?.trim() ||
      (process.env.NODE_ENV === "production"
        ? ""
        : "http://localhost:3002");
    if (!raw) {
      throw new ConflictException(
        "PUBLIC_INVOICE_BASE_URL must be configured."
      );
    }

    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new ConflictException(
        "PUBLIC_INVOICE_BASE_URL must be an absolute http(s) URL."
      );
    }
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new ConflictException(
        "PUBLIC_INVOICE_BASE_URL must use http or https."
      );
    }
    if (
      process.env.NODE_ENV === "production" &&
      url.protocol !== "https:"
    ) {
      throw new ConflictException(
        "PUBLIC_INVOICE_BASE_URL must use https in production."
      );
    }
    return raw.replace(/\/$/, "");
  }

  private message(
    cycleCode: string,
    displayName: string | null,
    invoices: readonly GroupedInvoice[]
  ): string {
    const money = new Intl.NumberFormat("vi-VN");
    const lines = invoices.flatMap((invoice) => [
      "- Phòng " +
        invoice.roomCode +
        ": " +
        money.format(invoice.remainingVnd) +
        "đ · hạn " +
        invoice.dueDate,
      "  " + invoice.publicUrl
    ]);

    const message = [
      displayName ? "Xin chào " + displayName + "," : "Xin chào,",
      "Habi gửi hóa đơn " + cycleCode + ":",
      ...lines,
      "Vui lòng mở đúng link ở trên để xem chi tiết và thanh toán."
    ].join("\n");

    if (message.length > 4000) {
      throw new ConflictException(
        "Personalized invoice notification exceeds 4000 characters."
      );
    }
    return message;
  }

  private dateOnly(value: Date | string) {
    return value instanceof Date
      ? value.toISOString().slice(0, 10)
      : String(value).slice(0, 10);
  }
}
