import { createHash, randomBytes } from "node:crypto";
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
import { RenterPaymentsService } from "../renter-payments/renter-payments.service.js";

type LinkInvoiceRow = QueryResultRow & {
  invoice_id: string;
  organization_id: string;
  property_id: string;
  status: "DRAFT" | "ISSUED" | "VOID";
  operational_group_ids: string[];
};

type PublicInvoiceRow = QueryResultRow & {
  organization_id: string;
  organization_name: string;
  property_name: string;
  room_code_snapshot: string;
  invoice_number: string;
  payment_reference: string;
  period_start: Date | string;
  period_end: Date | string;
  due_date: Date | string;
  total_vnd: string;
  paid_vnd: string;
  remaining_vnd: string;
  collection_status: "UNPAID" | "PARTIALLY_PAID" | "PAID";
  issued_at: Date | string;
  updated_at: Date | string;
};

type PublicLineRow = QueryResultRow & {
  line_type: string;
  description: string;
  quantity: string;
  unit_price_vnd: string;
  amount_vnd: string;
  sort_order: number;
};

@Injectable()
export class RenterPublicInvoiceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly accessControl: AccessControlService,
    private readonly commercialPolicy: CommercialPolicyService,
    private readonly payments: RenterPaymentsService
  ) {}

  async issueAccess(principal: TenantPrincipal, invoiceId: string) {
    return this.db.withTransaction(async (client) => {
      const invoice = await this.requireInvoiceManage(
        client,
        principal,
        invoiceId
      );
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      if (invoice.status !== "ISSUED") {
        throw new ConflictException(
          "Public invoice access can only be issued for an ISSUED invoice."
        );
      }

      await client.query(
        `UPDATE renter_invoice_public_links
         SET status = 'REVOKED',
             revoked_by_user_id = $3::uuid,
             revoked_at = now(),
             updated_at = now()
         WHERE organization_id = $1::uuid
           AND invoice_id = $2::uuid
           AND status = 'ACTIVE'`,
        [principal.organizationId, invoiceId, principal.userId]
      );

      const token = "habi_inv_" + randomBytes(24).toString("base64url");
      const tokenHash = this.hashToken(token);
      const tokenHint = token.slice(-6);

      const link = await client.query<QueryResultRow & {
        id: string;
        created_at: Date;
      }>(
        `INSERT INTO renter_invoice_public_links (
           organization_id,
           invoice_id,
           token_hash,
           token_hint,
           created_by_user_id
         )
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id::text, created_at`,
        [
          principal.organizationId,
          invoiceId,
          tokenHash,
          tokenHint,
          principal.userId
        ]
      );

      await this.audit(
        client,
        principal.organizationId,
        principal.userId,
        "RENTER_INVOICE_PUBLIC_LINK_ISSUED",
        invoiceId,
        {
          linkId: link.rows[0]!.id,
          tokenHint
        }
      );

      return {
        invoiceId,
        token,
        tokenHint,
        createdAt: link.rows[0]!.created_at.toISOString()
      };
    });
  }

  async revokeAccess(principal: TenantPrincipal, invoiceId: string) {
    return this.db.withTransaction(async (client) => {
      await this.requireInvoiceManage(client, principal, invoiceId);
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      const revoked = await client.query<QueryResultRow & { id: string }>(
        `UPDATE renter_invoice_public_links
         SET status = 'REVOKED',
             revoked_by_user_id = $3::uuid,
             revoked_at = now(),
             updated_at = now()
         WHERE organization_id = $1::uuid
           AND invoice_id = $2::uuid
           AND status = 'ACTIVE'
         RETURNING id::text`,
        [principal.organizationId, invoiceId, principal.userId]
      );

      await this.audit(
        client,
        principal.organizationId,
        principal.userId,
        "RENTER_INVOICE_PUBLIC_LINK_REVOKED",
        invoiceId,
        {
          revokedLinkIds: revoked.rows.map((row) => row.id)
        }
      );

      return {
        invoiceId,
        revoked: (revoked.rowCount ?? 0) > 0
      };
    });
  }

  async detail(token: string) {
    const tokenHash = this.hashToken(this.requireToken(token));
    const invoice = await this.db.query<PublicInvoiceRow>(
      `SELECT
         i.organization_id::text,
         o.name AS organization_name,
         i.property_name_snapshot AS property_name,
         i.room_code_snapshot,
         i.invoice_number,
         i.payment_reference,
         i.period_start,
         i.period_end,
         i.due_date,
         i.total_vnd::text,
         i.paid_vnd::text,
         i.remaining_vnd::text,
         i.collection_status,
         i.issued_at,
         i.updated_at
       FROM renter_invoice_public_links link
       JOIN renter_invoices i
         ON i.organization_id = link.organization_id
        AND i.id = link.invoice_id
       JOIN organizations o
         ON o.id = i.organization_id
       WHERE link.token_hash = $1
         AND link.status = 'ACTIVE'
         AND (link.expires_at IS NULL OR link.expires_at > now())
         AND i.status = 'ISSUED'
       LIMIT 1`,
      [tokenHash]
    );
    const row = invoice.rows[0];
    if (!row) {
      throw new NotFoundException("Public invoice link is invalid or no longer active.");
    }

    const lines = await this.db.query<PublicLineRow>(
      `SELECT
         line_type,
         description,
         quantity::text,
         unit_price_vnd::text,
         amount_vnd::text,
         sort_order
       FROM renter_invoice_lines
       WHERE organization_id = $1::uuid
         AND invoice_id = (
           SELECT invoice_id
           FROM renter_invoice_public_links
           WHERE token_hash = $2
             AND status = 'ACTIVE'
             AND (expires_at IS NULL OR expires_at > now())
           LIMIT 1
         )
       ORDER BY sort_order, id`,
      [row.organization_id, tokenHash]
    );

    const profile = await this.payments.publicPaymentProfile(row.organization_id);
    const remainingVnd = Number(row.remaining_vnd);
    const payment =
      profile && remainingVnd > 0
        ? {
            configured: true as const,
            bankId: profile.bankId,
            accountNo: profile.accountNo,
            accountName: profile.accountName,
            paymentReference: row.payment_reference,
            qrImageUrl: this.vietQrUrl({
              bankId: profile.bankId,
              accountNo: profile.accountNo,
              accountName: profile.accountName,
              template: profile.vietQrTemplate,
              amountVnd: remainingVnd,
              paymentReference: row.payment_reference
            })
          }
        : {
            configured: false as const,
            paymentReference: row.payment_reference
          };

    return {
      organizationName: row.organization_name,
      propertyName: row.property_name,
      roomCode: row.room_code_snapshot,
      invoiceNumber: row.invoice_number,
      periodStart: this.dateOnly(row.period_start),
      periodEnd: this.dateOnly(row.period_end),
      dueDate: this.dateOnly(row.due_date),
      issuedAt: this.timestamp(row.issued_at),
      totalVnd: Number(row.total_vnd),
      paidVnd: Number(row.paid_vnd),
      remainingVnd,
      collectionStatus: row.collection_status,
      updatedAt: this.timestamp(row.updated_at),
      lines: lines.rows.map((line) => ({
        type: line.line_type,
        description: line.description,
        quantity: line.quantity,
        unitPriceVnd: Number(line.unit_price_vnd),
        amountVnd: Number(line.amount_vnd)
      })),
      payment
    };
  }

  async status(token: string) {
    const tokenHash = this.hashToken(this.requireToken(token));
    const result = await this.db.query<QueryResultRow & {
      paid_vnd: string;
      remaining_vnd: string;
      collection_status: "UNPAID" | "PARTIALLY_PAID" | "PAID";
      updated_at: Date | string;
    }>(
      `SELECT
         i.paid_vnd::text,
         i.remaining_vnd::text,
         i.collection_status,
         i.updated_at
       FROM renter_invoice_public_links link
       JOIN renter_invoices i
         ON i.organization_id = link.organization_id
        AND i.id = link.invoice_id
       WHERE link.token_hash = $1
         AND link.status = 'ACTIVE'
         AND (link.expires_at IS NULL OR link.expires_at > now())
         AND i.status = 'ISSUED'
       LIMIT 1`,
      [tokenHash]
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException("Public invoice link is invalid or no longer active.");
    }
    return {
      paidVnd: Number(row.paid_vnd),
      remainingVnd: Number(row.remaining_vnd),
      collectionStatus: row.collection_status,
      updatedAt: this.timestamp(row.updated_at)
    };
  }

  private async requireInvoiceManage(
    client: PoolClient,
    principal: TenantPrincipal,
    invoiceId: string
  ): Promise<LinkInvoiceRow> {
    const result = await client.query<LinkInvoiceRow>(
      `SELECT
         id::text AS invoice_id,
         organization_id::text,
         property_id::text,
         status,
         '{}'::text[] AS operational_group_ids
       FROM renter_invoices
       WHERE organization_id = $1::uuid
         AND id = $2::uuid
       FOR UPDATE`,
      [principal.organizationId, invoiceId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException("Renter invoice was not found.");
    }
    const groups = await client.query<QueryResultRow & { id: string }>(
      `SELECT operational_group_id::text AS id
       FROM property_operational_groups
       WHERE organization_id = $1::uuid
         AND property_id = $2::uuid
       ORDER BY operational_group_id`,
      [principal.organizationId, row.property_id]
    );
    row.operational_group_ids = groups.rows.map((item) => item.id);
    if (
      !this.accessControl.can(principal.membership, "billing.manage", {
        organizationId: principal.organizationId,
        propertyId: row.property_id,
        operationalGroupIds: row.operational_group_ids
      })
    ) {
      throw new ForbiddenException("Billing manage permission denied for this invoice.");
    }
    return row;
  }

  private vietQrUrl(input: {
    bankId: string;
    accountNo: string;
    accountName: string;
    template: string;
    amountVnd: number;
    paymentReference: string;
  }) {
    const path =
      "https://img.vietqr.io/image/" +
      encodeURIComponent(input.bankId) +
      "-" +
      encodeURIComponent(input.accountNo) +
      "-" +
      encodeURIComponent(input.template) +
      ".png";
    const query = new URLSearchParams({
      amount: String(input.amountVnd),
      addInfo: input.paymentReference,
      accountName: input.accountName
    });
    return path + "?" + query.toString();
  }

  private requireToken(token: string) {
    const normalized = token.trim();
    if (!/^habi_inv_[A-Za-z0-9_-]{24,64}$/.test(normalized)) {
      throw new NotFoundException("Public invoice link is invalid or no longer active.");
    }
    return normalized;
  }

  private hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  private dateOnly(value: Date | string) {
    return value instanceof Date
      ? value.toISOString().slice(0, 10)
      : value.slice(0, 10);
  }

  private timestamp(value: Date | string) {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  private async audit(
    client: PoolClient,
    organizationId: string,
    actorUserId: string,
    action: string,
    invoiceId: string,
    metadata: Readonly<Record<string, unknown>>
  ) {
    await client.query(
      `INSERT INTO audit_events (
         organization_id,
         actor_user_id,
         action,
         resource_type,
         resource_id,
         metadata
       )
       VALUES ($1, $2, $3, 'RENTER_INVOICE', $4, $5::jsonb)`,
      [organizationId, actorUserId, action, invoiceId, JSON.stringify(metadata)]
    );
  }
}
