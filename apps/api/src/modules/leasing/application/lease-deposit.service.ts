import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import { CommercialPolicyService } from "../../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../../database/database.service.js";
import { AccessControlService } from "../../identity/access-control.service.js";
import type { Permission } from "../../identity/domain/access-control.js";
import type { TenantPrincipal } from "../../identity/tenant-principal.js";
import {
  assertReceiptMatches,
  normalizeIdempotencyKey
} from "./idempotent-command.js";
import { PostgresLeaseRepository } from "../infrastructure/postgres-lease-repository.js";

export type LeaseDepositStatus =
  | "NOT_REQUIRED"
  | "UNPAID"
  | "PARTIALLY_HELD"
  | "HELD"
  | "SETTLED";

export type LeaseDepositEntryType =
  | "COLLECTION"
  | "REFUND"
  | "DEDUCTION";

type LeaseDepositContextRow = QueryResultRow & {
  lease_id: string;
  lease_status: string;
  deposit_required_vnd: string;
  property_id: string;
};

type GroupRow = QueryResultRow & {
  operational_group_id: string;
};

type DepositAggregateRow = QueryResultRow & {
  collected_vnd: string;
  refunded_vnd: string;
  deducted_vnd: string;
};

type DepositEntryRow = QueryResultRow & {
  id: string;
  entry_type: LeaseDepositEntryType;
  amount_vnd: string;
  occurred_at: Date | string;
  note: string | null;
  created_at: Date | string;
};

type TerminationRow = QueryResultRow & {
  id: string;
  meter_readiness: "PENDING" | "READY" | "NOT_REQUIRED";
  financial_readiness: "PENDING" | "READY" | "NOT_REQUIRED";
  deposit_readiness: "PENDING" | "READY" | "NOT_REQUIRED";
};

interface LeaseDepositContext {
  leaseId: string;
  status: string;
  depositRequiredVnd: number;
  propertyId: string;
  operationalGroupIds: string[];
}

export interface RecordLeaseDepositCollectionInput {
  idempotencyKey: string;
  amountVnd: number;
  occurredAt: string;
  note?: string | null;
}

export interface SettleLeaseDepositInput {
  idempotencyKey: string;
  refundVnd: number;
  deductionVnd: number;
  occurredAt: string;
  note: string;
}

@Injectable()
export class LeaseDepositService {
  constructor(
    private readonly db: DatabaseService,
    private readonly accessControl: AccessControlService,
    private readonly commercialPolicy: CommercialPolicyService
  ) {}

  summary(principal: TenantPrincipal, leaseId: string) {
    return this.db.withTransaction(async (client) => {
      const context = await this.requireContext(
        client,
        principal,
        leaseId,
        "payment.read",
        false
      );
      return this.snapshot(client, principal, context);
    });
  }

  async recordCollection(
    principal: TenantPrincipal,
    leaseId: string,
    input: RecordLeaseDepositCollectionInput
  ) {
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    const amountVnd = this.positiveMoney(input.amountVnd, "amountVnd");
    const occurredAt = this.isoTimestamp(input.occurredAt, "occurredAt");
    const note = this.optionalNote(input.note);

    return this.db.withTransaction(async (client) => {
      const context = await this.requireContext(
        client,
        principal,
        leaseId,
        "payment.reconcile",
        true
      );
      const repository = new PostgresLeaseRepository(client);
      const receipt = await repository.findCommandReceipt(
        principal.organizationId,
        idempotencyKey
      );

      if (receipt) {
        assertReceiptMatches(receipt, {
          commandType: "LEASE_DEPOSIT_COLLECTION",
          leaseId
        });
        return receipt.response;
      }

      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      if (context.status !== "DRAFT" && context.status !== "ACTIVE") {
        throw new ConflictException(
          "Deposit collection can only be recorded while the lease is DRAFT or ACTIVE."
        );
      }

      const before = await this.snapshot(client, principal, context);
      if (amountVnd > before.outstandingVnd) {
        throw new ConflictException(
          "Deposit collection exceeds the remaining required deposit."
        );
      }

      await client.query(
        `INSERT INTO lease_deposit_entries (
           organization_id,
           lease_id,
           entry_type,
           amount_vnd,
           occurred_at,
           note,
           created_by_user_id
         )
         VALUES ($1, $2, 'COLLECTION', $3, $4::timestamptz, $5, $6)`,
        [
          principal.organizationId,
          leaseId,
          amountVnd,
          occurredAt,
          note,
          principal.userId
        ]
      );

      await this.audit(client, principal, leaseId, "LEASE_DEPOSIT_COLLECTED", {
        amountVnd,
        occurredAt,
        note,
        source: "MANUAL_OPERATOR"
      });

      const response = await this.snapshot(client, principal, context);

      await repository.saveCommandReceipt({
        organizationId: principal.organizationId,
        idempotencyKey,
        commandType: "LEASE_DEPOSIT_COLLECTION",
        leaseId,
        response
      });

      return response;
    });
  }

  async settle(
    principal: TenantPrincipal,
    leaseId: string,
    input: SettleLeaseDepositInput
  ) {
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    const refundVnd = this.money(input.refundVnd, "refundVnd");
    const deductionVnd = this.money(input.deductionVnd, "deductionVnd");
    const occurredAt = this.isoTimestamp(input.occurredAt, "occurredAt");
    const note = this.requiredNote(input.note);

    return this.db.withTransaction(async (client) => {
      const context = await this.requireContext(
        client,
        principal,
        leaseId,
        "payment.reconcile",
        true
      );
      const repository = new PostgresLeaseRepository(client);
      const receipt = await repository.findCommandReceipt(
        principal.organizationId,
        idempotencyKey
      );

      if (receipt) {
        assertReceiptMatches(receipt, {
          commandType: "LEASE_DEPOSIT_SETTLEMENT",
          leaseId
        });
        return receipt.response;
      }

      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      if (context.status !== "TERMINATION_SCHEDULED") {
        throw new ConflictException(
          "Deposit settlement requires an open lease termination workflow."
        );
      }

      const terminationResult = await client.query<TerminationRow>(
        `SELECT
           id::text,
           meter_readiness,
           financial_readiness,
           deposit_readiness
         FROM lease_terminations
         WHERE organization_id = $1::uuid
           AND lease_id = $2::uuid
           AND status IN ('SCHEDULED', 'READY')
         FOR UPDATE`,
        [principal.organizationId, leaseId]
      );
      const termination = terminationResult.rows[0];
      if (!termination) {
        throw new ConflictException(
          "Lease does not have an open termination workflow."
        );
      }

      const before = await this.snapshot(client, principal, context);
      if (refundVnd + deductionVnd !== before.heldVnd) {
        throw new ConflictException(
          "refundVnd plus deductionVnd must equal the currently held deposit."
        );
      }

      if (refundVnd > 0) {
        await this.insertSettlementEntry(client, {
          principal,
          leaseId,
          entryType: "REFUND",
          amountVnd: refundVnd,
          occurredAt,
          note
        });
      }
      if (deductionVnd > 0) {
        await this.insertSettlementEntry(client, {
          principal,
          leaseId,
          entryType: "DEDUCTION",
          amountVnd: deductionVnd,
          occurredAt,
          note
        });
      }

      const readiness =
        context.depositRequiredVnd === 0 &&
        before.collectedVnd === 0
          ? "NOT_REQUIRED"
          : "READY";

      const terminationUpdate = await client.query<
        QueryResultRow & {
          status: string;
          deposit_readiness: "READY" | "NOT_REQUIRED";
        }
      >(
        `UPDATE lease_terminations
         SET deposit_readiness = $3,
             status = CASE
               WHEN meter_readiness <> 'PENDING'
                AND financial_readiness <> 'PENDING'
                AND $3 <> 'PENDING'
               THEN 'READY'
               ELSE 'SCHEDULED'
             END,
             updated_at = now()
         WHERE organization_id = $1::uuid
           AND id = $2::uuid
           AND status IN ('SCHEDULED', 'READY')
         RETURNING status, deposit_readiness`,
        [principal.organizationId, termination.id, readiness]
      );

      if (terminationUpdate.rowCount !== 1) {
        throw new ConflictException(
          "Termination workflow changed concurrently."
        );
      }

      await this.audit(client, principal, leaseId, "LEASE_DEPOSIT_SETTLED", {
        previousHeldVnd: before.heldVnd,
        refundVnd,
        deductionVnd,
        occurredAt,
        note,
        depositReadiness: readiness,
        source: "MANUAL_OPERATOR"
      });

      const deposit = await this.snapshot(client, principal, context);
      const response = {
        ...deposit,
        termination: {
          status: terminationUpdate.rows[0]!.status,
          depositReadiness:
            terminationUpdate.rows[0]!.deposit_readiness
        }
      };

      await repository.saveCommandReceipt({
        organizationId: principal.organizationId,
        idempotencyKey,
        commandType: "LEASE_DEPOSIT_SETTLEMENT",
        leaseId,
        response
      });

      return response;
    });
  }

  private async requireContext(
    client: PoolClient,
    principal: TenantPrincipal,
    leaseId: string,
    permission: Permission,
    lock: boolean
  ): Promise<LeaseDepositContext> {
    const result = await client.query<LeaseDepositContextRow>(
      `SELECT
         l.id::text AS lease_id,
         l.status AS lease_status,
         l.deposit_required_vnd::text,
         r.property_id::text
       FROM leases l
       JOIN rooms r
         ON r.organization_id = l.organization_id
        AND r.id = l.room_id
       WHERE l.organization_id = $1::uuid
         AND l.id = $2::uuid
       \${lock ? "FOR UPDATE OF l" : ""}`,
      [principal.organizationId, leaseId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException("Lease was not found.");
    }

    const groupResult = await client.query<GroupRow>(
      `SELECT operational_group_id::text
       FROM property_operational_groups
       WHERE organization_id = $1::uuid
         AND property_id = $2::uuid
       ORDER BY operational_group_id`,
      [principal.organizationId, row.property_id]
    );
    const operationalGroupIds = groupResult.rows.map(
      (item) => item.operational_group_id
    );

    if (
      !this.accessControl.can(principal.membership, permission, {
        organizationId: principal.organizationId,
        propertyId: row.property_id,
        operationalGroupIds
      })
    ) {
      throw new ForbiddenException("Deposit payment permission denied.");
    }

    return {
      leaseId: row.lease_id,
      status: row.lease_status,
      depositRequiredVnd: Number(row.deposit_required_vnd),
      propertyId: row.property_id,
      operationalGroupIds
    };
  }

  private async snapshot(
    client: PoolClient,
    principal: TenantPrincipal,
    context: LeaseDepositContext
  ) {
    const [aggregateResult, entryResult] = await Promise.all([
      client.query<DepositAggregateRow>(
        `SELECT
           COALESCE(sum(amount_vnd) FILTER (WHERE entry_type = 'COLLECTION'), 0)::text
             AS collected_vnd,
           COALESCE(sum(amount_vnd) FILTER (WHERE entry_type = 'REFUND'), 0)::text
             AS refunded_vnd,
           COALESCE(sum(amount_vnd) FILTER (WHERE entry_type = 'DEDUCTION'), 0)::text
             AS deducted_vnd
         FROM lease_deposit_entries
         WHERE organization_id = $1::uuid
           AND lease_id = $2::uuid`,
        [principal.organizationId, context.leaseId]
      ),
      client.query<DepositEntryRow>(
        `SELECT
           id::text,
           entry_type,
           amount_vnd::text,
           occurred_at,
           note,
           created_at
         FROM lease_deposit_entries
         WHERE organization_id = $1::uuid
           AND lease_id = $2::uuid
         ORDER BY occurred_at DESC, created_at DESC, id DESC
         LIMIT 50`,
        [principal.organizationId, context.leaseId]
      )
    ]);

    const aggregate = aggregateResult.rows[0]!;
    const collectedVnd = Number(aggregate.collected_vnd);
    const refundedVnd = Number(aggregate.refunded_vnd);
    const deductedVnd = Number(aggregate.deducted_vnd);
    const heldVnd = collectedVnd - refundedVnd - deductedVnd;
    if (heldVnd < 0) {
      throw new ConflictException(
        "Deposit ledger is inconsistent: settled amount exceeds collections."
      );
    }

    const outstandingVnd = Math.max(
      context.depositRequiredVnd - collectedVnd,
      0
    );
    const status = this.status({
      requiredVnd: context.depositRequiredVnd,
      collectedVnd,
      heldVnd,
      refundedVnd,
      deductedVnd
    });

    return {
      leaseId: context.leaseId,
      requiredVnd: context.depositRequiredVnd,
      collectedVnd,
      refundedVnd,
      deductedVnd,
      heldVnd,
      outstandingVnd,
      status,
      permissions: {
        reconcile: this.accessControl.can(
          principal.membership,
          "payment.reconcile",
          {
            organizationId: principal.organizationId,
            propertyId: context.propertyId,
            operationalGroupIds: context.operationalGroupIds
          }
        )
      },
      entries: entryResult.rows.map((entry) => ({
        id: entry.id,
        type: entry.entry_type,
        amountVnd: Number(entry.amount_vnd),
        occurredAt: this.timestamp(entry.occurred_at),
        note: entry.note,
        createdAt: this.timestamp(entry.created_at)
      }))
    };
  }

  private status(input: {
    requiredVnd: number;
    collectedVnd: number;
    heldVnd: number;
    refundedVnd: number;
    deductedVnd: number;
  }): LeaseDepositStatus {
    if (
      input.requiredVnd === 0 &&
      input.collectedVnd === 0 &&
      input.refundedVnd === 0 &&
      input.deductedVnd === 0
    ) {
      return "NOT_REQUIRED";
    }
    if (input.collectedVnd === 0) return "UNPAID";
    if (input.heldVnd === 0) return "SETTLED";
    if (input.collectedVnd < input.requiredVnd) return "PARTIALLY_HELD";
    return "HELD";
  }

  private async insertSettlementEntry(
    client: PoolClient,
    input: {
      principal: TenantPrincipal;
      leaseId: string;
      entryType: "REFUND" | "DEDUCTION";
      amountVnd: number;
      occurredAt: string;
      note: string;
    }
  ): Promise<void> {
    await client.query(
      `INSERT INTO lease_deposit_entries (
         organization_id,
         lease_id,
         entry_type,
         amount_vnd,
         occurred_at,
         note,
         created_by_user_id
       )
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7)`,
      [
        input.principal.organizationId,
        input.leaseId,
        input.entryType,
        input.amountVnd,
        input.occurredAt,
        input.note,
        input.principal.userId
      ]
    );
  }

  private async audit(
    client: PoolClient,
    principal: TenantPrincipal,
    leaseId: string,
    action: string,
    metadata: Readonly<Record<string, unknown>>
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_events (
         organization_id,
         actor_user_id,
         action,
         resource_type,
         resource_id,
         metadata
       )
       VALUES ($1, $2, $3, 'LEASE', $4, $5::jsonb)`,
      [
        principal.organizationId,
        principal.userId,
        action,
        leaseId,
        JSON.stringify(metadata)
      ]
    );
  }

  private money(value: number, field: string): number {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ConflictException(
        field + " must be a non-negative integer VND amount."
      );
    }
    return value;
  }

  private positiveMoney(value: number, field: string): number {
    const amount = this.money(value, field);
    if (amount === 0) {
      throw new ConflictException(field + " must be greater than zero.");
    }
    return amount;
  }

  private isoTimestamp(value: string, field: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new ConflictException(field + " must be a valid date-time.");
    }
    return date.toISOString();
  }

  private optionalNote(value: string | null | undefined): string | null {
    const normalized = value?.trim() ?? "";
    if (normalized.length > 1000) {
      throw new ConflictException("note must not exceed 1000 characters.");
    }
    return normalized || null;
  }

  private requiredNote(value: string): string {
    const normalized = value.trim();
    if (!normalized) {
      throw new ConflictException(
        "A settlement note is required for audit."
      );
    }
    if (normalized.length > 1000) {
      throw new ConflictException("note must not exceed 1000 characters.");
    }
    return normalized;
  }

  private timestamp(value: Date | string): string {
    return value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();
  }
}
