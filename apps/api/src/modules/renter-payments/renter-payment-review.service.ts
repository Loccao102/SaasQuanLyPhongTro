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

type ReviewRow = QueryResultRow & {
  transaction_id: string;
  provider: string;
  provider_transaction_id: string;
  payment_reference: string;
  amount_vnd: string;
  allocated_vnd: string;
  occurred_at: Date | string;
  payer_name: string | null;
  note: string | null;
  reconciliation_status: "REVIEW_REQUIRED" | "ALLOCATED";
  invoice_id: string;
  invoice_number: string;
  invoice_status: "DRAFT" | "ISSUED" | "VOID";
  property_id: string;
  property_code: string;
  property_name: string;
  room_code: string;
  total_vnd: string;
  paid_vnd: string;
  remaining_vnd: string;
  collection_status: "UNPAID" | "PARTIALLY_PAID" | "PAID";
  due_date: Date | string;
  last_error_code: string | null;
  last_error_message: string | null;
  webhook_received_at: Date | string | null;
};

type AllocationRow = QueryResultRow & {
  id: string;
  payment_transaction_id: string;
  invoice_id: string;
  amount_vnd: string;
};

export interface ResolveProviderReviewInput {
  allocationId: string;
  amountVnd: number;
  reason: string;
}

@Injectable()
export class RenterPaymentReviewService {
  constructor(
    private readonly db: DatabaseService,
    private readonly accessControl: AccessControlService,
    private readonly commercialPolicy: CommercialPolicyService
  ) {}

  async list(principal: TenantPrincipal) {
    this.requireRolePermission(principal, "payment.read");
    const scope = this.scopeParameters(principal);
    const result = await this.db.query<ReviewRow>(
      this.reviewSelectSql(
        `t.organization_id = $1::uuid
         AND t.source = 'PROVIDER'
         AND t.reconciliation_status = 'REVIEW_REQUIRED'
         AND (
           $2::boolean
           OR i.property_id = ANY($3::uuid[])
           OR EXISTS (
             SELECT 1
             FROM property_operational_groups pog
             WHERE pog.organization_id = t.organization_id
               AND pog.property_id = i.property_id
               AND pog.operational_group_id = ANY($4::uuid[])
           )
         )`
      ) + " ORDER BY t.occurred_at DESC, t.id DESC LIMIT 100",
      [
        principal.organizationId,
        scope.organizationWide,
        scope.propertyIds,
        scope.operationalGroupIds
      ]
    );

    return {
      organization: {
        id: principal.organizationId,
        name: principal.organizationName
      },
      count: result.rows.length,
      items: result.rows.map((row) => this.mapReview(row, principal))
    };
  }

  async detail(principal: TenantPrincipal, transactionId: string) {
    this.requireRolePermission(principal, "payment.read");
    const scope = this.scopeParameters(principal);
    const result = await this.db.query<ReviewRow>(
      this.reviewSelectSql(
        `t.organization_id = $1::uuid
         AND t.id = $2::uuid
         AND t.source = 'PROVIDER'
         AND (
           $3::boolean
           OR i.property_id = ANY($4::uuid[])
           OR EXISTS (
             SELECT 1
             FROM property_operational_groups pog
             WHERE pog.organization_id = t.organization_id
               AND pog.property_id = i.property_id
               AND pog.operational_group_id = ANY($5::uuid[])
           )
         )`
      ),
      [
        principal.organizationId,
        transactionId,
        scope.organizationWide,
        scope.propertyIds,
        scope.operationalGroupIds
      ]
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException("Provider payment review was not found in the current scope.");
    }
    return this.mapReview(row, principal);
  }

  async allocateReferencedInvoice(
    principal: TenantPrincipal,
    transactionId: string,
    input: ResolveProviderReviewInput
  ) {
    this.requireRolePermission(principal, "payment.reconcile");
    const amountVnd = this.money(input.amountVnd);
    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 500) {
      throw new ConflictException("reason must contain 3-500 characters.");
    }

    const result = await this.db.withTransaction(async (client) => {
      const row = await this.lockReview(client, principal, transactionId);
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      const existing = await client.query<AllocationRow>(
        `SELECT
           id::text,
           payment_transaction_id::text,
           invoice_id::text,
           amount_vnd::text
         FROM renter_payment_allocations
         WHERE organization_id = $1::uuid
           AND id = $2::uuid
         LIMIT 1`,
        [principal.organizationId, input.allocationId]
      );
      const existingAllocation = existing.rows[0];
      if (existingAllocation) {
        if (
          existingAllocation.payment_transaction_id !== transactionId ||
          existingAllocation.invoice_id !== row.invoice_id ||
          Number(existingAllocation.amount_vnd) !== amountVnd
        ) {
          throw new ConflictException(
            "allocationId was already used with different reconciliation data."
          );
        }
        return this.resultFromRow(row);
      }

      if (row.reconciliation_status !== "REVIEW_REQUIRED") {
        throw new ConflictException("Provider transaction no longer requires review.");
      }
      if (row.invoice_status !== "ISSUED") {
        throw new ConflictException(
          "Referenced invoice is not ISSUED and cannot receive payment."
        );
      }
      if (row.collection_status === "PAID" || Number(row.remaining_vnd) === 0) {
        throw new ConflictException("Referenced invoice is already fully paid.");
      }

      const transactionAmount = Number(row.amount_vnd);
      const allocatedBefore = Number(row.allocated_vnd);
      const transactionUnallocated = transactionAmount - allocatedBefore;
      const invoiceRemaining = Number(row.remaining_vnd);

      if (transactionUnallocated <= 0) {
        throw new ConflictException("Provider transaction is already fully allocated.");
      }
      if (amountVnd > transactionUnallocated) {
        throw new ConflictException(
          "Allocation exceeds the provider transaction unallocated amount."
        );
      }
      if (amountVnd > invoiceRemaining) {
        throw new ConflictException(
          "Allocation exceeds the referenced invoice remaining amount."
        );
      }

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
          transactionId,
          row.invoice_id,
          amountVnd,
          principal.userId
        ]
      );

      const invoicePaid = await this.sumInvoicePaid(
        client,
        principal.organizationId,
        row.invoice_id
      );
      const totalVnd = Number(row.total_vnd);
      if (invoicePaid > totalVnd) {
        throw new ConflictException("Invoice allocations exceed invoice total.");
      }
      const remainingVnd = totalVnd - invoicePaid;
      const collectionStatus =
        remainingVnd === 0
          ? "PAID"
          : invoicePaid === 0
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
          row.invoice_id,
          invoicePaid,
          remainingVnd,
          collectionStatus
        ]
      );

      const allocatedAfter = allocatedBefore + amountVnd;
      const reconciliationStatus =
        allocatedAfter === transactionAmount ? "ALLOCATED" : "REVIEW_REQUIRED";

      await client.query(
        `UPDATE renter_payment_transactions
         SET reconciliation_status = $3
         WHERE organization_id = $1::uuid
           AND id = $2::uuid`,
        [principal.organizationId, transactionId, reconciliationStatus]
      );

      if (reconciliationStatus === "ALLOCATED") {
        await client.query(
          `UPDATE renter_payment_webhook_events
           SET processing_status = 'PROCESSED',
               last_error_code = NULL,
               last_error_message = NULL,
               processed_at = COALESCE(processed_at, now()),
               updated_at = now()
           WHERE organization_id = $1::uuid
             AND payment_transaction_id = $2::uuid
             AND processing_status = 'REVIEW_REQUIRED'`,
          [principal.organizationId, transactionId]
        );
      }

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
           $1, $2, 'RENTER_PROVIDER_PAYMENT_MANUALLY_RECONCILED',
           'RENTER_PAYMENT_TRANSACTION', $3, $4::jsonb
         )`,
        [
          principal.organizationId,
          principal.userId,
          transactionId,
          JSON.stringify({
            allocationId: input.allocationId,
            invoiceId: row.invoice_id,
            amountVnd,
            reason,
            provider: row.provider,
            providerTransactionId: row.provider_transaction_id,
            transactionAmountVnd: transactionAmount,
            allocatedBeforeVnd: allocatedBefore,
            allocatedAfterVnd: allocatedAfter,
            transactionUnallocatedVnd: transactionAmount - allocatedAfter,
            invoicePaidVnd: invoicePaid,
            invoiceRemainingVnd: remainingVnd,
            reconciliationStatus,
            collectionStatus
          })
        ]
      );

      return {
        transactionId,
        invoiceId: row.invoice_id,
        allocationId: input.allocationId,
        amountVnd,
        transactionAmountVnd: transactionAmount,
        allocatedVnd: allocatedAfter,
        unallocatedVnd: transactionAmount - allocatedAfter,
        reconciliationStatus,
        invoice: {
          id: row.invoice_id,
          number: row.invoice_number,
          paidVnd: invoicePaid,
          remainingVnd,
          collectionStatus
        }
      };
    });

    return result;
  }

  private async lockReview(
    client: PoolClient,
    principal: TenantPrincipal,
    transactionId: string
  ): Promise<ReviewRow> {
    const result = await client.query<ReviewRow>(
      this.reviewSelectSql(
        `t.organization_id = $1::uuid
         AND t.id = $2::uuid
         AND t.source = 'PROVIDER'`
      ) + " FOR UPDATE OF t, i",
      [principal.organizationId, transactionId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException("Provider payment review was not found.");
    }

    const groups = await client.query<QueryResultRow & { id: string }>(
      `SELECT operational_group_id::text AS id
       FROM property_operational_groups
       WHERE organization_id = $1::uuid
         AND property_id = $2::uuid`,
      [principal.organizationId, row.property_id]
    );

    if (
      !this.accessControl.can(principal.membership, "payment.reconcile", {
        organizationId: principal.organizationId,
        propertyId: row.property_id,
        operationalGroupIds: groups.rows.map((item) => item.id)
      })
    ) {
      throw new ForbiddenException("Payment reconciliation permission denied for this property.");
    }

    return row;
  }

  private reviewSelectSql(whereClause: string): string {
    return `SELECT
       t.id::text AS transaction_id,
       t.provider,
       t.provider_transaction_id,
       t.payment_reference,
       t.amount_vnd::text,
       COALESCE((
         SELECT sum(a.amount_vnd)
         FROM renter_payment_allocations a
         WHERE a.organization_id = t.organization_id
           AND a.payment_transaction_id = t.id
       ), 0)::text AS allocated_vnd,
       t.occurred_at,
       t.payer_name,
       t.note,
       t.reconciliation_status,
       i.id::text AS invoice_id,
       i.invoice_number,
       i.status AS invoice_status,
       i.property_id::text,
       p.code AS property_code,
       p.name AS property_name,
       i.room_code_snapshot AS room_code,
       i.total_vnd::text,
       i.paid_vnd::text,
       i.remaining_vnd::text,
       i.collection_status,
       i.due_date,
       webhook.last_error_code,
       webhook.last_error_message,
       webhook.received_at AS webhook_received_at
     FROM renter_payment_transactions t
     JOIN renter_invoices i
       ON i.organization_id = t.organization_id
      AND i.payment_reference = t.payment_reference
     JOIN properties p
       ON p.organization_id = i.organization_id
      AND p.id = i.property_id
     LEFT JOIN LATERAL (
       SELECT
         e.last_error_code,
         e.last_error_message,
         e.received_at
       FROM renter_payment_webhook_events e
       WHERE e.organization_id = t.organization_id
         AND e.payment_transaction_id = t.id
       ORDER BY e.received_at DESC, e.id DESC
       LIMIT 1
     ) webhook ON true
     WHERE ${whereClause}`;
  }

  private scopeParameters(principal: TenantPrincipal) {
    const propertyIds: string[] = [];
    const operationalGroupIds: string[] = [];
    let organizationWide = false;

    for (const scope of principal.membership.scopes) {
      if (scope.type === "ORGANIZATION") {
        organizationWide = true;
      } else if (scope.type === "PROPERTY") {
        propertyIds.push(scope.propertyId);
      } else if (scope.type === "OPERATIONAL_GROUP") {
        operationalGroupIds.push(scope.operationalGroupId);
      }
    }

    return {
      organizationWide,
      propertyIds,
      operationalGroupIds
    };
  }

  private mapReview(row: ReviewRow, principal: TenantPrincipal) {
    const allocatedVnd = Number(row.allocated_vnd);
    const amountVnd = Number(row.amount_vnd);
    return {
      id: row.transaction_id,
      provider: row.provider,
      providerTransactionId: row.provider_transaction_id,
      paymentReference: row.payment_reference,
      amountVnd,
      allocatedVnd,
      unallocatedVnd: amountVnd - allocatedVnd,
      occurredAt: this.timestamp(row.occurred_at),
      payerName: row.payer_name,
      note: row.note,
      reconciliationStatus: row.reconciliation_status,
      reason: {
        code: row.last_error_code,
        message: row.last_error_message
      },
      invoice: {
        id: row.invoice_id,
        number: row.invoice_number,
        status: row.invoice_status,
        property: {
          id: row.property_id,
          code: row.property_code,
          name: row.property_name
        },
        roomCode: row.room_code,
        totalVnd: Number(row.total_vnd),
        paidVnd: Number(row.paid_vnd),
        remainingVnd: Number(row.remaining_vnd),
        collectionStatus: row.collection_status,
        dueDate: this.date(row.due_date)
      },
      canReconcile: roleHasPermission(principal.role, "payment.reconcile")
    };
  }

  private resultFromRow(row: ReviewRow) {
    const amountVnd = Number(row.amount_vnd);
    const allocatedVnd = Number(row.allocated_vnd);
    return {
      transactionId: row.transaction_id,
      invoiceId: row.invoice_id,
      allocationId: null,
      amountVnd: 0,
      transactionAmountVnd: amountVnd,
      allocatedVnd,
      unallocatedVnd: amountVnd - allocatedVnd,
      reconciliationStatus: row.reconciliation_status,
      invoice: {
        id: row.invoice_id,
        number: row.invoice_number,
        paidVnd: Number(row.paid_vnd),
        remainingVnd: Number(row.remaining_vnd),
        collectionStatus: row.collection_status
      }
    };
  }

  private async sumInvoicePaid(
    client: PoolClient,
    organizationId: string,
    invoiceId: string
  ): Promise<number> {
    const result = await client.query<QueryResultRow & { paid_vnd: string }>(
      `SELECT COALESCE(sum(a.amount_vnd), 0)::text AS paid_vnd
       FROM renter_payment_allocations a
       JOIN renter_payment_transactions t
         ON t.organization_id = a.organization_id
        AND t.id = a.payment_transaction_id
        AND t.status = 'POSTED'
       WHERE a.organization_id = $1::uuid
         AND a.invoice_id = $2::uuid`,
      [organizationId, invoiceId]
    );
    return Number(result.rows[0]?.paid_vnd ?? "0");
  }

  private requireRolePermission(
    principal: TenantPrincipal,
    permission: "payment.read" | "payment.reconcile"
  ) {
    if (!roleHasPermission(principal.role, permission)) {
      throw new ForbiddenException("Payment permission denied.");
    }
  }

  private money(value: number): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new ConflictException("amountVnd must be a positive integer VND amount.");
    }
    return value;
  }

  private timestamp(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  private date(value: Date | string): string {
    return value instanceof Date
      ? value.toISOString().slice(0, 10)
      : String(value).slice(0, 10);
  }
}
