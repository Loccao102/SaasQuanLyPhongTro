import { createHash, randomBytes } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional
} from "@nestjs/common";
import { CacheService } from "../cache/cache.service.js";
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
  subtotal_vnd: string;
  adjustment_vnd: string;
  previous_balance_vnd: string;
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
  private readonly statusCache = new Map<
    string,
    {
      data: {
        paidVnd: number;
        remainingVnd: number;
        collectionStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID";
        updatedAt: string;
      };
      expiresAt: number;
    }
  >();

  constructor(
    private readonly db: DatabaseService,
    private readonly accessControl: AccessControlService,
    private readonly commercialPolicy: CommercialPolicyService,
    private readonly payments: RenterPaymentsService,
    @Optional() private readonly cache?: CacheService
  ) {
    if (this.cache) {
      this.cache.subscribe<{ tokenHash?: string }>(
        "public_invoice_status_invalidated",
        (msg) => {
          if (msg?.tokenHash) {
            this.statusCache.delete(msg.tokenHash);
          } else {
            this.statusCache.clear();
          }
        }
      );
    }
  }

  async invalidateStatus(tokenHash?: string) {
    if (tokenHash) {
      this.statusCache.delete(tokenHash);
    } else {
      this.statusCache.clear();
    }
    if (this.cache) {
      await this.cache.publish("public_invoice_status_invalidated", { tokenHash });
    }
  }

  async issueAccess(principal: TenantPrincipal, invoiceId: string) {
    return this.db.withTransaction((client) =>
      this.issueAccessInTransaction(client, principal, invoiceId)
    );
  }

  async issueAccessInTransaction(
    client: PoolClient,
    principal: TenantPrincipal,
    invoiceId: string
  ) {
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
         i.subtotal_vnd::text,
         i.adjustment_vnd::text,
         i.previous_balance_vnd::text,
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
      subtotalVnd: Number(row.subtotal_vnd),
      adjustmentVnd: Number(row.adjustment_vnd),
      previousBalanceVnd: Number(row.previous_balance_vnd),
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
    const now = Date.now();
    const cached = this.statusCache.get(tokenHash);
    if (cached && now < cached.expiresAt) {
      return cached.data;
    }

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
    const data = {
      paidVnd: Number(row.paid_vnd),
      remainingVnd: Number(row.remaining_vnd),
      collectionStatus: row.collection_status,
      updatedAt: this.timestamp(row.updated_at)
    };

    const ttlMs = data.collectionStatus === "PAID" ? 120000 : 2500;
    this.statusCache.set(tokenHash, { data, expiresAt: now + ttlMs });

    if (this.statusCache.size > 2000) {
      for (const [key, entry] of this.statusCache.entries()) {
        if (now >= entry.expiresAt) {
          this.statusCache.delete(key);
        }
      }
    }

    return data;
  }

  async portal(token: string) {
    const tokenHash = this.hashToken(this.requireToken(token));
    const invoiceRes = await this.db.query<QueryResultRow & {
      organization_id: string;
      room_id: string;
      lease_id: string;
      organization_name: string;
      property_name: string;
      room_code_snapshot: string;
      invoice_number: string;
      period_start: Date | string;
      period_end: Date | string;
      due_date: Date | string;
      total_vnd: string;
      paid_vnd: string;
      remaining_vnd: string;
      collection_status: "UNPAID" | "PARTIALLY_PAID" | "PAID";
    }>(
      `SELECT
         i.organization_id::text,
         i.room_id::text,
         i.lease_id::text,
         o.name AS organization_name,
         i.property_name_snapshot AS property_name,
         i.room_code_snapshot,
         i.invoice_number,
         i.period_start,
         i.period_end,
         i.due_date,
         i.total_vnd::text,
         i.paid_vnd::text,
         i.remaining_vnd::text,
         i.collection_status
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

    const inv = invoiceRes.rows[0];
    if (!inv) {
      throw new NotFoundException("Public invoice link is invalid or no longer active.");
    }

    const leaseRes = await this.db.query<QueryResultRow & {
      lease_code: string;
      lease_status: string;
      start_date: Date | string;
      planned_end_date: Date | string | null;
      base_rent_vnd: string;
      deposit_required_vnd: string;
      billing_day: number;
      resident_name: string | null;
      resident_phone: string | null;
      signature_data_url: string | null;
      signed_at: Date | string | null;
      signed_by_name: string | null;
    }>(
      `SELECT
         l.lease_code,
         l.status AS lease_status,
         l.start_date,
         l.planned_end_date,
         l.base_rent_vnd::text,
         l.deposit_required_vnd::text,
         l.billing_day,
         l.signature_data_url,
         l.signed_at,
         l.signed_by_name,
         r.full_name AS resident_name,
         r.phone AS resident_phone
       FROM leases l
       LEFT JOIN lease_residents lr
         ON lr.organization_id = l.organization_id
        AND lr.lease_id = l.id
        AND lr.party_role = 'PRIMARY_TENANT'
       LEFT JOIN residents r
         ON r.organization_id = lr.organization_id
        AND r.id = lr.resident_id
       WHERE l.organization_id = $1::uuid
         AND l.id = $2::uuid
       LIMIT 1`,
      [inv.organization_id, inv.lease_id]
    );
    const leaseRow = leaseRes.rows[0];

    const historyRes = await this.db.query<QueryResultRow & {
      id: string;
      invoice_number: string;
      period_start: Date | string;
      period_end: Date | string;
      due_date: Date | string;
      total_vnd: string;
      paid_vnd: string;
      remaining_vnd: string;
      collection_status: "UNPAID" | "PARTIALLY_PAID" | "PAID";
      issued_at: Date | string;
    }>(
      `SELECT
         id::text,
         invoice_number,
         period_start,
         period_end,
         due_date,
         total_vnd::text,
         paid_vnd::text,
         remaining_vnd::text,
         collection_status,
         issued_at
       FROM renter_invoices
       WHERE organization_id = $1::uuid
         AND room_id = $2::uuid
         AND status = 'ISSUED'
       ORDER BY period_end DESC
       LIMIT 12`,
      [inv.organization_id, inv.room_id]
    );

    const eqRes = await this.db.query<QueryResultRow & {
      id: string;
      name: string;
      brand: string | null;
      model_or_serial: string | null;
      quantity: number;
      condition_status: string;
      note: string | null;
    }>(
      `SELECT
         id::text,
         name,
         brand,
         model_or_serial,
         quantity,
         condition_status,
         note
       FROM room_equipment
       WHERE organization_id = $1::uuid
         AND room_id = $2::uuid
       ORDER BY name ASC`,
      [inv.organization_id, inv.room_id]
    );

    return {
      organizationName: inv.organization_name,
      propertyName: inv.property_name,
      roomCode: inv.room_code_snapshot,
      lease: leaseRow
        ? {
            code: leaseRow.lease_code,
            status: leaseRow.lease_status,
            startDate: this.dateOnly(leaseRow.start_date),
            plannedEndDate: leaseRow.planned_end_date ? this.dateOnly(leaseRow.planned_end_date) : null,
            baseRentVnd: Number(leaseRow.base_rent_vnd),
            depositVnd: Number(leaseRow.deposit_required_vnd),
            billingDay: leaseRow.billing_day,
            signatureDataUrl: leaseRow.signature_data_url || null,
            signedAt: leaseRow.signed_at ? this.timestamp(leaseRow.signed_at) : null,
            signedByName: leaseRow.signed_by_name || null
          }
        : null,
      primaryResident: {
        fullName: leaseRow?.resident_name || null,
        phone: leaseRow?.resident_phone || null
      },
      invoices: historyRes.rows.map((row) => ({
        id: row.id,
        invoiceNumber: row.invoice_number,
        periodStart: this.dateOnly(row.period_start),
        periodEnd: this.dateOnly(row.period_end),
        dueDate: this.dateOnly(row.due_date),
        totalVnd: Number(row.total_vnd),
        paidVnd: Number(row.paid_vnd),
        remainingVnd: Number(row.remaining_vnd),
        collectionStatus: row.collection_status,
        issuedAt: this.timestamp(row.issued_at)
      })),
      equipment: eqRes.rows.map((row) => ({
        id: row.id,
        name: row.name,
        brand: row.brand,
        modelOrSerial: row.model_or_serial,
        quantity: row.quantity,
        conditionStatus: row.condition_status,
        note: row.note
      }))
    };
  }

  async signLease(
    token: string,
    input: {
      signatureDataUrl: string;
      signedByName: string;
      clientIp?: string;
    }
  ): Promise<{ success: boolean; signedAt: string; message: string }> {
    const tokenHash = this.hashToken(this.requireToken(token));
    const invoiceRes = await this.db.query<{
      organization_id: string;
      lease_id: string;
    }>(
      `SELECT
         i.organization_id::text,
         i.lease_id::text
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

    const inv = invoiceRes.rows[0];
    if (!inv || !inv.lease_id) {
      throw new NotFoundException("Đường link hoá đơn không hợp lệ hoặc không có hợp đồng gắn kèm.");
    }

    const signature = input.signatureDataUrl?.trim();
    if (!signature || !signature.startsWith("data:image/")) {
      throw new BadRequestException("Chữ ký điện tử không hợp lệ.");
    }

    const signedByName = input.signedByName?.trim();
    if (!signedByName || signedByName.length < 2 || signedByName.length > 100) {
      throw new BadRequestException("Vui lòng nhập họ và tên người ký (2 - 100 ký tự).");
    }

    const signedAt = new Date();
    await this.db.query(
      `UPDATE leases
       SET signature_data_url = $1,
           signed_at = $2,
           signed_by_name = $3,
           signed_ip = $4,
           updated_at = now()
       WHERE organization_id = $5::uuid
         AND id = $6::uuid`,
      [signature, signedAt, signedByName, input.clientIp || null, inv.organization_id, inv.lease_id]
    );

    await this.db.query(
      `INSERT INTO audit_events (
         organization_id,
         actor_user_id,
         action,
         resource_type,
         resource_id,
         metadata
       )
       VALUES ($1::uuid, NULL, $2, 'LEASE', $3::uuid, $4::jsonb)`,
      [
        inv.organization_id,
        "LEASE_E_SIGNED",
        inv.lease_id,
        JSON.stringify({
          signedByName,
          signedAt: signedAt.toISOString(),
          clientIp: input.clientIp || null
        })
      ]
    );

    return {
      success: true,
      signedAt: signedAt.toISOString(),
      message: "Ký xác nhận hợp đồng điện tử thành công."
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
    if (!/^habi_inv_[A-Za-z0-9_-]{32}$/.test(normalized)) {
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
