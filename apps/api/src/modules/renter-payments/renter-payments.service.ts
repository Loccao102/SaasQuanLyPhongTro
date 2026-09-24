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
import { roleHasPermission } from "../identity/domain/access-control.js";
import type { TenantPrincipal } from "../identity/tenant-principal.js";

type InvoiceContextRow = QueryResultRow & {
  id: string;
  property_id: string;
  property_code: string;
  property_name: string;
  room_code_snapshot: string;
  invoice_number: string;
  payment_reference: string;
  primary_resident_name_snapshot: string;
  status: "DRAFT" | "ISSUED" | "VOID";
  total_vnd: string;
  paid_vnd: string;
  remaining_vnd: string;
  collection_status: "UNPAID" | "PARTIALLY_PAID" | "PAID";
  due_date: Date | string;
  operational_group_ids: string[];
};

type LockedInvoiceRow = QueryResultRow & {
  id: string;
  property_id: string;
  room_code_snapshot: string;
  invoice_number: string;
  primary_resident_name_snapshot: string;
  status: "DRAFT" | "ISSUED" | "VOID";
  total_vnd: string;
  paid_vnd: string;
  remaining_vnd: string;
  collection_status: "UNPAID" | "PARTIALLY_PAID" | "PAID";
  due_date: Date | string;
};

type PaymentProfileRow = QueryResultRow & {
  organization_id: string;
  bank_id: string;
  account_no: string;
  account_name: string;
  vietqr_template: string;
  is_active: boolean;
  updated_at: Date | string;
};

type TransactionAllocationRow = QueryResultRow & {
  transaction_id: string;
  source: "MANUAL" | "PROVIDER";
  provider: string | null;
  provider_transaction_id: string | null;
  transaction_amount_vnd: string;
  occurred_at: Date | string;
  payer_name: string | null;
  note: string | null;
  transaction_status: "POSTED" | "REVERSED";
  allocation_id: string;
  invoice_id: string;
  allocated_amount_vnd: string;
  allocation_type: "MANUAL" | "AUTO";
  created_at: Date | string;
};

export interface CreateManualAllocationInput {
  transactionId: string;
  allocationId: string;
  invoiceId: string;
  amountVnd: number;
  occurredAt: string;
  payerName?: string | null;
  note?: string | null;
}

@Injectable()
export class RenterPaymentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly accessControl: AccessControlService,
    private readonly commercialPolicy: CommercialPolicyService
  ) {}

  async detail(principal: TenantPrincipal, invoiceId: string) {
    const invoice = await this.loadInvoice(
      this.db,
      principal,
      invoiceId,
      "payment.read"
    );
    const allocations = await this.db.query<TransactionAllocationRow>(
      `SELECT
         t.id::text AS transaction_id,
         t.source,
         t.provider,
         t.provider_transaction_id,
         t.amount_vnd::text AS transaction_amount_vnd,
         t.occurred_at,
         t.payer_name,
         t.note,
         t.status AS transaction_status,
         a.id::text AS allocation_id,
         a.invoice_id::text,
         a.amount_vnd::text AS allocated_amount_vnd,
         a.allocation_type,
         a.created_at
       FROM renter_payment_allocations a
       JOIN renter_payment_transactions t
         ON t.organization_id = a.organization_id
        AND t.id = a.payment_transaction_id
       WHERE a.organization_id = $1::uuid
         AND a.invoice_id = $2::uuid
       ORDER BY t.occurred_at, a.created_at, a.id`,
      [principal.organizationId, invoiceId]
    );

    return {
      organization: {
        id: principal.organizationId,
        name: principal.organizationName
      },
      invoice: this.mapInvoice(invoice),
      permissions: {
        reconcile:
          roleHasPermission(principal.role, "payment.reconcile") &&
          this.accessControl.can(principal.membership, "payment.reconcile", {
            organizationId: principal.organizationId,
            propertyId: invoice.property_id,
            operationalGroupIds: invoice.operational_group_ids
          })
      },
      allocations: allocations.rows.map((row) => this.mapAllocation(row))
    };
  }

  async paymentProfile(principal: TenantPrincipal) {
    this.requireOrganizationPaymentPermission(principal, "payment.read");
    const profile = await this.db.query<PaymentProfileRow>(
      `SELECT
         organization_id::text,
         bank_id,
         account_no,
         account_name,
         vietqr_template,
         is_active,
         updated_at
       FROM organization_payment_profiles
       WHERE organization_id = $1::uuid
       LIMIT 1`,
      [principal.organizationId]
    );
    return {
      organization: {
        id: principal.organizationId,
        name: principal.organizationName
      },
      profile: profile.rows[0] ? this.mapPaymentProfile(profile.rows[0]) : null,
      canManage: this.accessControl.can(
        principal.membership,
        "payment.reconcile",
        { organizationId: principal.organizationId }
      )
    };
  }

  async updatePaymentProfile(
    principal: TenantPrincipal,
    input: {
      bankId: string;
      accountNo: string;
      accountName: string;
      vietQrTemplate: string;
      isActive: boolean;
    }
  ) {
    this.requireOrganizationPaymentPermission(principal, "payment.reconcile");
    const bankId = this.boundedToken(input.bankId, "bankId", 2, 32);
    const accountNo = this.boundedToken(input.accountNo, "accountNo", 3, 19);
    const accountName = this.boundedText(
      input.accountName,
      "accountName",
      2,
      80
    );
    const vietQrTemplate = this.boundedToken(
      input.vietQrTemplate,
      "vietQrTemplate",
      1,
      64
    );

    return this.db.withTransaction(async (client) => {
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      const previous = await client.query<PaymentProfileRow>(
        `SELECT
           organization_id::text,
           bank_id,
           account_no,
           account_name,
           vietqr_template,
           is_active,
           updated_at
         FROM organization_payment_profiles
         WHERE organization_id = $1::uuid
         FOR UPDATE`,
        [principal.organizationId]
      );

      const updated = await client.query<PaymentProfileRow>(
        `INSERT INTO organization_payment_profiles (
           organization_id,
           bank_id,
           account_no,
           account_name,
           vietqr_template,
           is_active,
           updated_by_user_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (organization_id)
         DO UPDATE SET
           bank_id = EXCLUDED.bank_id,
           account_no = EXCLUDED.account_no,
           account_name = EXCLUDED.account_name,
           vietqr_template = EXCLUDED.vietqr_template,
           is_active = EXCLUDED.is_active,
           updated_by_user_id = EXCLUDED.updated_by_user_id,
           updated_at = now()
         RETURNING
           organization_id::text,
           bank_id,
           account_no,
           account_name,
           vietqr_template,
           is_active,
           updated_at`,
        [
          principal.organizationId,
          bankId,
          accountNo,
          accountName,
          vietQrTemplate,
          input.isActive,
          principal.userId
        ]
      );

      await this.audit(
        client,
        principal,
        "RENTER_PAYMENT_PROFILE_UPDATED",
        "ORGANIZATION_PAYMENT_PROFILE",
        principal.organizationId,
        {
          before: previous.rows[0]
            ? {
                bankId: previous.rows[0].bank_id,
                accountNo: this.maskAccount(previous.rows[0].account_no),
                accountName: previous.rows[0].account_name,
                vietQrTemplate: previous.rows[0].vietqr_template,
                isActive: previous.rows[0].is_active
              }
            : null,
          after: {
            bankId,
            accountNo: this.maskAccount(accountNo),
            accountName,
            vietQrTemplate,
            isActive: input.isActive
          }
        }
      );

      return this.mapPaymentProfile(updated.rows[0]!);
    });
  }

  async publicPaymentProfile(organizationId: string) {
    const result = await this.db.query<PaymentProfileRow>(
      `SELECT
         organization_id::text,
         bank_id,
         account_no,
         account_name,
         vietqr_template,
         is_active,
         updated_at
       FROM organization_payment_profiles
       WHERE organization_id = $1::uuid
         AND is_active = true
       LIMIT 1`,
      [organizationId]
    );
    return result.rows[0] ? this.mapPaymentProfile(result.rows[0]) : null;
  }

  async createManualAllocation(
    principal: TenantPrincipal,
    input: CreateManualAllocationInput
  ) {
    const amountVnd = this.money(input.amountVnd, "amountVnd");
    if (amountVnd <= 0) {
      throw new ConflictException("amountVnd must be greater than zero.");
    }
    const occurredAt = this.isoTimestamp(input.occurredAt, "occurredAt");
    const payerName = this.optionalText(input.payerName);
    const note = this.optionalText(input.note);

    return this.db.withTransaction(async (client) => {
      const invoice = await this.requireInvoiceForUpdate(
        client,
        principal,
        input.invoiceId
      );
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      const existing = await client.query<TransactionAllocationRow>(
        `SELECT
           t.id::text AS transaction_id,
           t.source,
           t.provider,
           t.provider_transaction_id,
           t.amount_vnd::text AS transaction_amount_vnd,
           t.occurred_at,
           t.payer_name,
           t.note,
           t.status AS transaction_status,
           a.id::text AS allocation_id,
           a.invoice_id::text,
           a.amount_vnd::text AS allocated_amount_vnd,
           a.allocation_type,
           a.created_at
         FROM renter_payment_transactions t
         LEFT JOIN renter_payment_allocations a
           ON a.organization_id = t.organization_id
          AND a.payment_transaction_id = t.id
         WHERE t.organization_id = $1::uuid
           AND t.id = $2::uuid
         LIMIT 1`,
        [principal.organizationId, input.transactionId]
      );
      const existingRow = existing.rows[0];
      if (existingRow) {
        if (
          existingRow.source !== "MANUAL" ||
          Number(existingRow.transaction_amount_vnd) !== amountVnd ||
          this.timestamp(existingRow.occurred_at) !== occurredAt ||
          existingRow.payer_name !== payerName ||
          existingRow.note !== note ||
          existingRow.allocation_id !== input.allocationId ||
          existingRow.invoice_id !== input.invoiceId ||
          Number(existingRow.allocated_amount_vnd) !== amountVnd ||
          existingRow.allocation_type !== "MANUAL"
        ) {
          throw new ConflictException(
            "Payment transaction id was already used with different data."
          );
        }
        return this.detailWithClient(
          client,
          principal.organizationId,
          input.invoiceId
        );
      }

      if (invoice.status !== "ISSUED") {
        throw new ConflictException(
          "Payments can only be allocated to an ISSUED renter invoice."
        );
      }
      if (invoice.collection_status === "PAID" || Number(invoice.remaining_vnd) === 0) {
        throw new ConflictException("Invoice is already fully paid.");
      }
      if (amountVnd > Number(invoice.remaining_vnd)) {
        throw new ConflictException(
          "Allocation exceeds invoice remaining amount. Overpayment requires a separate review policy."
        );
      }

      await client.query(
        `INSERT INTO renter_payment_transactions (
           id,
           organization_id,
           source,
           amount_vnd,
           occurred_at,
           payer_name,
           note,
           status,
           created_by_user_id
         )
         VALUES ($1, $2, 'MANUAL', $3, $4::timestamptz, $5, $6, 'POSTED', $7)`,
        [
          input.transactionId,
          principal.organizationId,
          amountVnd,
          occurredAt,
          payerName,
          note,
          principal.userId
        ]
      );

      await client.query(
        `INSERT INTO renter_payment_allocations (
           id,
           organization_id,
           payment_transaction_id,
           invoice_id,
           amount_vnd,
           allocation_type,
           created_by_user_id
         )
         VALUES ($1, $2, $3, $4, $5, 'MANUAL', $6)`,
        [
          input.allocationId,
          principal.organizationId,
          input.transactionId,
          input.invoiceId,
          amountVnd,
          principal.userId
        ]
      );

      const paidResult = await client.query<QueryResultRow & { paid_vnd: string }>(
        `SELECT COALESCE(sum(a.amount_vnd), 0)::text AS paid_vnd
         FROM renter_payment_allocations a
         JOIN renter_payment_transactions t
           ON t.organization_id = a.organization_id
          AND t.id = a.payment_transaction_id
          AND t.status = 'POSTED'
         WHERE a.organization_id = $1::uuid
           AND a.invoice_id = $2::uuid`,
        [principal.organizationId, input.invoiceId]
      );
      const paidVnd = Number(paidResult.rows[0]?.paid_vnd ?? "0");
      const totalVnd = Number(invoice.total_vnd);
      if (paidVnd > totalVnd) {
        throw new ConflictException(
          "Payment allocations exceed invoice total and require review."
        );
      }
      const remainingVnd = totalVnd - paidVnd;
      const collectionStatus =
        remainingVnd === 0
          ? "PAID"
          : paidVnd === 0
            ? "UNPAID"
            : "PARTIALLY_PAID";

      await client.query(
        `UPDATE renter_invoices
         SET paid_vnd = $3,
             remaining_vnd = $4,
             collection_status = $5,
             updated_at = now()
         WHERE organization_id = $1::uuid
           AND id = $2::uuid`,
        [
          principal.organizationId,
          input.invoiceId,
          paidVnd,
          remainingVnd,
          collectionStatus
        ]
      );

      await this.audit(
        client,
        principal,
        "RENTER_PAYMENT_MANUALLY_ALLOCATED",
        "RENTER_INVOICE",
        input.invoiceId,
        {
          transactionId: input.transactionId,
          allocationId: input.allocationId,
          amountVnd,
          paidVnd,
          remainingVnd,
          collectionStatus,
          occurredAt
        }
      );

      return this.detailWithClient(
        client,
        principal.organizationId,
        input.invoiceId
      );
    });
  }

  private async loadInvoice(
    db: Pick<DatabaseService, "query">,
    principal: TenantPrincipal,
    invoiceId: string,
    permission: "payment.read"
  ): Promise<InvoiceContextRow> {
    if (!roleHasPermission(principal.role, permission)) {
      throw new ForbiddenException("Payment read permission denied.");
    }

    const result = await db.query<InvoiceContextRow>(
      `SELECT
         i.id::text,
         i.property_id::text,
         p.code AS property_code,
         p.name AS property_name,
         i.room_code_snapshot,
         i.invoice_number,
         i.payment_reference,
         i.primary_resident_name_snapshot,
         i.status,
         i.total_vnd::text,
         i.paid_vnd::text,
         i.remaining_vnd::text,
         i.collection_status,
         i.due_date,
         COALESCE(
           array_agg(DISTINCT pog.operational_group_id::text)
             FILTER (WHERE pog.operational_group_id IS NOT NULL),
           '{}'::text[]
         ) AS operational_group_ids
       FROM renter_invoices i
       JOIN properties p
         ON p.organization_id = i.organization_id
        AND p.id = i.property_id
       LEFT JOIN property_operational_groups pog
         ON pog.organization_id = p.organization_id
        AND pog.property_id = p.id
       WHERE i.organization_id = $1::uuid
         AND i.id = $2::uuid
       GROUP BY i.id, p.code, p.name
       LIMIT 1`,
      [principal.organizationId, invoiceId]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Renter invoice was not found.");
    if (
      !this.accessControl.can(principal.membership, permission, {
        organizationId: principal.organizationId,
        propertyId: row.property_id,
        operationalGroupIds: row.operational_group_ids
      })
    ) {
      throw new ForbiddenException("Payment scope denied for this invoice.");
    }
    return row;
  }

  private async requireInvoiceForUpdate(
    client: PoolClient,
    principal: TenantPrincipal,
    invoiceId: string
  ): Promise<LockedInvoiceRow> {
    if (!roleHasPermission(principal.role, "payment.reconcile")) {
      throw new ForbiddenException("Payment reconcile permission denied.");
    }

    const invoiceResult = await client.query<LockedInvoiceRow>(
      `SELECT
         id::text,
         property_id::text,
         room_code_snapshot,
         invoice_number,
         primary_resident_name_snapshot,
         status,
         total_vnd::text,
         paid_vnd::text,
         remaining_vnd::text,
         collection_status,
         due_date
       FROM renter_invoices
       WHERE organization_id = $1::uuid
         AND id = $2::uuid
       FOR UPDATE`,
      [principal.organizationId, invoiceId]
    );
    const invoice = invoiceResult.rows[0];
    if (!invoice) throw new NotFoundException("Renter invoice was not found.");

    const scopeResult = await client.query<QueryResultRow & {
      operational_group_ids: string[];
    }>(
      `SELECT COALESCE(
           array_agg(DISTINCT pog.operational_group_id::text)
             FILTER (WHERE pog.operational_group_id IS NOT NULL),
           '{}'::text[]
         ) AS operational_group_ids
       FROM properties p
       LEFT JOIN property_operational_groups pog
         ON pog.organization_id = p.organization_id
        AND pog.property_id = p.id
       WHERE p.organization_id = $1::uuid
         AND p.id = $2::uuid
       GROUP BY p.id`,
      [principal.organizationId, invoice.property_id]
    );
    const operationalGroupIds =
      scopeResult.rows[0]?.operational_group_ids ?? [];
    if (
      !this.accessControl.can(principal.membership, "payment.reconcile", {
        organizationId: principal.organizationId,
        propertyId: invoice.property_id,
        operationalGroupIds
      })
    ) {
      throw new ForbiddenException("Payment scope denied for this invoice.");
    }
    return invoice;
  }

  private async detailWithClient(
    client: PoolClient,
    organizationId: string,
    invoiceId: string
  ) {
    const [invoiceResult, allocationResult] = await Promise.all([
      client.query<QueryResultRow & {
        id: string;
        invoice_number: string;
        room_code_snapshot: string;
        primary_resident_name_snapshot: string;
        status: string;
        total_vnd: string;
        paid_vnd: string;
        remaining_vnd: string;
        collection_status: string;
        due_date: Date | string;
      }>(
        `SELECT
           id::text,
           invoice_number,
           room_code_snapshot,
           primary_resident_name_snapshot,
           status,
           total_vnd::text,
           paid_vnd::text,
           remaining_vnd::text,
           collection_status,
           due_date
         FROM renter_invoices
         WHERE organization_id = $1::uuid
           AND id = $2::uuid
         LIMIT 1`,
        [organizationId, invoiceId]
      ),
      client.query<TransactionAllocationRow>(
        `SELECT
           t.id::text AS transaction_id,
           t.source,
           t.provider,
           t.provider_transaction_id,
           t.amount_vnd::text AS transaction_amount_vnd,
           t.occurred_at,
           t.payer_name,
           t.note,
           t.status AS transaction_status,
           a.id::text AS allocation_id,
           a.invoice_id::text,
           a.amount_vnd::text AS allocated_amount_vnd,
           a.allocation_type,
           a.created_at
         FROM renter_payment_allocations a
         JOIN renter_payment_transactions t
           ON t.organization_id = a.organization_id
          AND t.id = a.payment_transaction_id
         WHERE a.organization_id = $1::uuid
           AND a.invoice_id = $2::uuid
         ORDER BY t.occurred_at, a.created_at, a.id`,
        [organizationId, invoiceId]
      )
    ]);
    const invoice = invoiceResult.rows[0]!;
    return {
      invoice: {
        id: invoice.id,
        number: invoice.invoice_number,
        roomCode: invoice.room_code_snapshot,
        primaryResidentName: invoice.primary_resident_name_snapshot,
        status: invoice.status,
        totalVnd: Number(invoice.total_vnd),
        paidVnd: Number(invoice.paid_vnd),
        remainingVnd: Number(invoice.remaining_vnd),
        collectionStatus: invoice.collection_status,
        dueDate: this.dateOnly(invoice.due_date)
      },
      allocations: allocationResult.rows.map((row) => this.mapAllocation(row))
    };
  }

  private mapInvoice(row: InvoiceContextRow) {
    return {
      id: row.id,
      number: row.invoice_number,
      paymentReference: row.payment_reference,
      property: {
        id: row.property_id,
        code: row.property_code,
        name: row.property_name
      },
      roomCode: row.room_code_snapshot,
      primaryResidentName: row.primary_resident_name_snapshot,
      status: row.status,
      totalVnd: Number(row.total_vnd),
      paidVnd: Number(row.paid_vnd),
      remainingVnd: Number(row.remaining_vnd),
      collectionStatus: row.collection_status,
      dueDate: this.dateOnly(row.due_date)
    };
  }

  private mapAllocation(row: TransactionAllocationRow) {
    return {
      id: row.allocation_id,
      amountVnd: Number(row.allocated_amount_vnd),
      type: row.allocation_type,
      createdAt: this.timestamp(row.created_at),
      transaction: {
        id: row.transaction_id,
        source: row.source,
        provider: row.provider,
        providerTransactionId: row.provider_transaction_id,
        amountVnd: Number(row.transaction_amount_vnd),
        occurredAt: this.timestamp(row.occurred_at),
        payerName: row.payer_name,
        note: row.note,
        status: row.transaction_status
      }
    };
  }

  private requireOrganizationPaymentPermission(
    principal: TenantPrincipal,
    permission: "payment.read" | "payment.reconcile"
  ) {
    if (
      !this.accessControl.can(principal.membership, permission, {
        organizationId: principal.organizationId
      })
    ) {
      throw new ForbiddenException(
        "Organization-level payment permission denied."
      );
    }
  }

  private mapPaymentProfile(row: PaymentProfileRow) {
    return {
      organizationId: row.organization_id,
      bankId: row.bank_id,
      accountNo: row.account_no,
      accountName: row.account_name,
      vietQrTemplate: row.vietqr_template,
      isActive: row.is_active,
      updatedAt: this.timestamp(row.updated_at)
    };
  }

  private boundedToken(
    value: string,
    field: string,
    minLength: number,
    maxLength: number
  ) {
    const normalized = value.trim();
    if (
      normalized.length < minLength ||
      normalized.length > maxLength ||
      !/^[A-Za-z0-9_-]+$/.test(normalized)
    ) {
      throw new ConflictException(
        field +
          " must be " +
          String(minLength) +
          "-" +
          String(maxLength) +
          " letters, numbers, _ or -."
      );
    }
    return normalized;
  }

  private boundedText(
    value: string,
    field: string,
    minLength: number,
    maxLength: number
  ) {
    const normalized = value.trim();
    if (
      normalized.length < minLength ||
      normalized.length > maxLength
    ) {
      throw new ConflictException(
        field +
          " must be between " +
          String(minLength) +
          " and " +
          String(maxLength) +
          " characters."
      );
    }
    return normalized;
  }

  private maskAccount(accountNo: string) {
    if (accountNo.length <= 4) return accountNo;
    return "*".repeat(Math.max(0, accountNo.length - 4)) + accountNo.slice(-4);
  }

  private money(value: number, field: string) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ConflictException(
        field + " must be a non-negative safe integer VND amount."
      );
    }
    return value;
  }

  private optionalText(value: string | null | undefined) {
    const normalized = value?.trim() ?? "";
    return normalized.length === 0 ? null : normalized;
  }

  private isoTimestamp(value: string, field: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new ConflictException(field + " must be a valid ISO timestamp.");
    }
    return date.toISOString();
  }

  private timestamp(value: Date | string) {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  private dateOnly(value: Date | string) {
    return value instanceof Date
      ? value.toISOString().slice(0, 10)
      : value.slice(0, 10);
  }

  private async audit(
    client: PoolClient,
    principal: TenantPrincipal,
    action: string,
    resourceType: string,
    resourceId: string,
    metadata: Readonly<Record<string, unknown>>
  ) {
    await client.query(
      `INSERT INTO audit_events (
         organization_id, actor_user_id, action, resource_type, resource_id, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        principal.organizationId,
        principal.userId,
        action,
        resourceType,
        resourceId,
        JSON.stringify(metadata)
      ]
    );
  }
}
