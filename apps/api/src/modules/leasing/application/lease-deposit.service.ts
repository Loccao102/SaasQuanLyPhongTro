import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { CommercialPolicyService } from "../../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../../database/database.service.js";
import { AccessControlService } from "../../identity/access-control.service.js";
import type { TenantPrincipal } from "../../identity/tenant-principal.js";
import {
  calculateDepositStatus,
  collectDeposit as domainCollectDeposit,
  settleDeposit as domainSettleDeposit,
  type DepositMovement,
  type DepositMovementType,
  type DepositState,
  type DepositStatus,
  type PaymentMethod
} from "../domain/deposit-lifecycle.js";
import { PostgresLeaseRepository } from "../infrastructure/postgres-lease-repository.js";

interface SqlQueryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<T>>;
}

interface LeaseContextRow extends QueryResultRow {
  lease_id: string;
  lease_status: string;
  property_id: string;
  deposit_required_vnd: string;
  operational_group_ids: string[];
}

interface DepositRow extends QueryResultRow {
  status: DepositStatus;
  deposit_required_vnd: string;
  total_collected_vnd: string;
  total_deducted_vnd: string;
  total_refunded_vnd: string;
  remaining_held_vnd: string;
}

interface MovementRow extends QueryResultRow {
  id: string;
  movement_type: DepositMovementType;
  amount_vnd: string;
  payment_method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  occurred_at: Date;
  created_at: Date;
}

export interface DepositSummaryDto {
  status: DepositStatus;
  depositRequiredVnd: number;
  totalCollectedVnd: number;
  totalDeductedVnd: number;
  totalRefundedVnd: number;
  remainingHeldVnd: number;
  movements: DepositMovement[];
}

export interface CollectDepositInput {
  idempotencyKey: string;
  amountVnd: number;
  paymentMethod?: PaymentMethod;
  reference?: string | null;
  notes?: string | null;
  occurredAt?: string | null;
}

export interface SettleDepositInput {
  idempotencyKey: string;
  deductionAmountVnd: number;
  refundAmountVnd: number;
  deductionReason?: string | null;
  refundReference?: string | null;
  notes?: string | null;
  occurredAt?: string | null;
}

@Injectable()
export class LeaseDepositService {
  constructor(
    private readonly db: DatabaseService,
    private readonly accessControl: AccessControlService,
    private readonly commercialPolicy: CommercialPolicyService
  ) {}

  async getDepositSummary(
    clientOrDb: SqlQueryable,
    organizationId: string,
    leaseId: string,
    depositRequiredVnd: number
  ): Promise<DepositSummaryDto> {
    const depositResult = await clientOrDb.query<DepositRow>(
      `SELECT
         status,
         deposit_required_vnd::text,
         total_collected_vnd::text,
         total_deducted_vnd::text,
         total_refunded_vnd::text,
         remaining_held_vnd::text
       FROM lease_deposits
       WHERE organization_id = $1::uuid
         AND lease_id = $2::uuid
       LIMIT 1`,
      [organizationId, leaseId]
    );

    const movementsResult = await clientOrDb.query<MovementRow>(
      `SELECT
         id::text,
         movement_type,
         amount_vnd::text,
         payment_method,
         reference,
         notes,
         occurred_at,
         created_at
       FROM lease_deposit_movements
       WHERE organization_id = $1::uuid
         AND lease_id = $2::uuid
       ORDER BY occurred_at DESC, created_at DESC`,
      [organizationId, leaseId]
    );

    const movements: DepositMovement[] = movementsResult.rows.map(
      (row: MovementRow) => ({
        id: row.id,
        movementType: row.movement_type,
        amountVnd: Number(row.amount_vnd),
        paymentMethod: row.payment_method,
        reference: row.reference,
        notes: row.notes,
        occurredAt: this.dateOnly(row.occurred_at),
        createdAt: row.created_at.toISOString()
      })
    );

    const depositRow = depositResult.rows[0];
    if (depositRow) {
      return {
        status: depositRow.status,
        depositRequiredVnd: Number(depositRow.deposit_required_vnd),
        totalCollectedVnd: Number(depositRow.total_collected_vnd),
        totalDeductedVnd: Number(depositRow.total_deducted_vnd),
        totalRefundedVnd: Number(depositRow.total_refunded_vnd),
        remainingHeldVnd: Number(depositRow.remaining_held_vnd),
        movements
      };
    }

    const initial = calculateDepositStatus(depositRequiredVnd, 0, 0, 0);
    return {
      status: initial.status,
      depositRequiredVnd,
      totalCollectedVnd: 0,
      totalDeductedVnd: 0,
      totalRefundedVnd: 0,
      remainingHeldVnd: initial.remainingHeldVnd,
      movements
    };
  }

  async collectDeposit(
    principal: TenantPrincipal,
    leaseId: string,
    input: CollectDepositInput
  ): Promise<DepositSummaryDto> {
    const idempotencyKey = this.requiredText(input.idempotencyKey, "idempotencyKey");

    return this.db.withTransaction(async (client) => {
      const repository = new PostgresLeaseRepository(client);
      const existingReceipt = await repository.findCommandReceipt(
        principal.organizationId,
        idempotencyKey
      );

      if (existingReceipt) {
        if (
          existingReceipt.commandType !== "LEASE_DEPOSIT_COLLECT" ||
          existingReceipt.leaseId !== leaseId
        ) {
          throw new ConflictException(
            "Idempotency key was already used for a different command or lease."
          );
        }
        return existingReceipt.response as DepositSummaryDto;
      }

      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      const context = await this.loadLeaseContext(client, principal.organizationId, leaseId);
      if (!this.accessControl.can(principal.membership, "lease.manage", {
        organizationId: principal.organizationId,
        propertyId: context.property_id,
        operationalGroupIds: context.operational_group_ids
      })) {
        throw new ForbiddenException("Lease manage permission denied.");
      }

      if (context.lease_status === "CANCELLED" || context.lease_status === "TERMINATED") {
        throw new ConflictException("Cannot collect deposit for an inactive lease.");
      }

      const depositRequiredVnd = Number(context.deposit_required_vnd);
      const current = await this.getDepositStateForUpdate(
        client,
        principal.organizationId,
        leaseId,
        depositRequiredVnd
      );

      const amountVnd = this.money(input.amountVnd, "amountVnd");
      if (amountVnd <= 0) {
        throw new ConflictException("Collect amount must be greater than 0.");
      }

      const paymentMethod = input.paymentMethod ?? "BANK_TRANSFER";
      const reference = this.optionalText(input.reference);
      const notes = this.optionalText(input.notes);
      const occurredAt = input.occurredAt
        ? this.dateOnlyString(input.occurredAt)
        : this.currentDateString();

      const nextState = domainCollectDeposit(current, { amountVnd });

      await client.query(
        `INSERT INTO lease_deposits (
           organization_id,
           lease_id,
           status,
           deposit_required_vnd,
           total_collected_vnd,
           total_deducted_vnd,
           total_refunded_vnd,
           remaining_held_vnd,
           updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         ON CONFLICT (organization_id, lease_id)
         DO UPDATE SET
           status = EXCLUDED.status,
           deposit_required_vnd = EXCLUDED.deposit_required_vnd,
           total_collected_vnd = EXCLUDED.total_collected_vnd,
           remaining_held_vnd = EXCLUDED.remaining_held_vnd,
           updated_at = now()`,
        [
          principal.organizationId,
          leaseId,
          nextState.status,
          nextState.depositRequiredVnd,
          nextState.totalCollectedVnd,
          nextState.totalDeductedVnd,
          nextState.totalRefundedVnd,
          nextState.remainingHeldVnd
        ]
      );

      await client.query(
        `INSERT INTO lease_deposit_movements (
           organization_id,
           lease_id,
           movement_type,
           amount_vnd,
           payment_method,
           reference,
           notes,
           occurred_at,
           created_by_user_id
         )
         VALUES ($1, $2, 'COLLECTION', $3, $4, $5, $6, $7, $8)`,
        [
          principal.organizationId,
          leaseId,
          amountVnd,
          paymentMethod,
          reference,
          notes,
          occurredAt,
          principal.userId
        ]
      );

      await client.query(
        `INSERT INTO audit_events (
           organization_id,
           actor_user_id,
           action,
           resource_type,
           resource_id,
           metadata
         )
         VALUES ($1, $2, 'LEASE_DEPOSIT_COLLECTED', 'LEASE', $3, $4::jsonb)`,
        [
          principal.organizationId,
          principal.userId,
          leaseId,
          JSON.stringify({
            amountVnd,
            paymentMethod,
            reference,
            totalCollectedVnd: nextState.totalCollectedVnd,
            remainingHeldVnd: nextState.remainingHeldVnd,
            status: nextState.status
          })
        ]
      );

      const summary = await this.getDepositSummary(
        client,
        principal.organizationId,
        leaseId,
        depositRequiredVnd
      );

      await repository.saveCommandReceipt({
        organizationId: principal.organizationId,
        idempotencyKey,
        commandType: "LEASE_DEPOSIT_COLLECT",
        leaseId,
        response: summary
      });

      return summary;
    });
  }

  async settleDeposit(
    principal: TenantPrincipal,
    leaseId: string,
    input: SettleDepositInput
  ): Promise<DepositSummaryDto> {
    const idempotencyKey = this.requiredText(input.idempotencyKey, "idempotencyKey");

    return this.db.withTransaction(async (client) => {
      const repository = new PostgresLeaseRepository(client);
      const existingReceipt = await repository.findCommandReceipt(
        principal.organizationId,
        idempotencyKey
      );

      if (existingReceipt) {
        if (
          existingReceipt.commandType !== "LEASE_DEPOSIT_SETTLE" ||
          existingReceipt.leaseId !== leaseId
        ) {
          throw new ConflictException(
            "Idempotency key was already used for a different command or lease."
          );
        }
        return existingReceipt.response as DepositSummaryDto;
      }

      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      const context = await this.loadLeaseContext(client, principal.organizationId, leaseId);
      const canSettle =
        this.accessControl.can(principal.membership, "lease.terminate", {
          organizationId: principal.organizationId,
          propertyId: context.property_id,
          operationalGroupIds: context.operational_group_ids
        }) ||
        this.accessControl.can(principal.membership, "lease.manage", {
          organizationId: principal.organizationId,
          propertyId: context.property_id,
          operationalGroupIds: context.operational_group_ids
        });

      if (!canSettle) {
        throw new ForbiddenException("Deposit settlement permission denied.");
      }

      if (context.lease_status === "CANCELLED" || context.lease_status === "DRAFT") {
        throw new ConflictException("Cannot settle deposit for a draft or cancelled lease.");
      }

      const depositRequiredVnd = Number(context.deposit_required_vnd);
      const current = await this.getDepositStateForUpdate(
        client,
        principal.organizationId,
        leaseId,
        depositRequiredVnd
      );

      const deductionAmountVnd = this.money(input.deductionAmountVnd, "deductionAmountVnd");
      const refundAmountVnd = this.money(input.refundAmountVnd, "refundAmountVnd");

      if (deductionAmountVnd + refundAmountVnd <= 0) {
        throw new ConflictException("Total settlement amount must be greater than 0.");
      }

      if (current.remainingHeldVnd <= 0) {
        throw new ConflictException("Held deposit is zero; no deposit available to settle.");
      }

      if (deductionAmountVnd + refundAmountVnd > current.remainingHeldVnd) {
        throw new ConflictException(
          `Settlement amount (${deductionAmountVnd + refundAmountVnd} VND) exceeds remaining held deposit (${current.remainingHeldVnd} VND).`
        );
      }

      const nextState = domainSettleDeposit(current, {
        deductionAmountVnd,
        refundAmountVnd
      });

      const occurredAt = input.occurredAt
        ? this.dateOnlyString(input.occurredAt)
        : this.currentDateString();
      const deductionReason = this.optionalText(input.deductionReason);
      const refundReference = this.optionalText(input.refundReference);
      const notes = this.optionalText(input.notes);

      await client.query(
        `UPDATE lease_deposits
         SET status = $3,
             total_deducted_vnd = $4,
             total_refunded_vnd = $5,
             remaining_held_vnd = $6,
             updated_at = now()
         WHERE organization_id = $1::uuid
           AND lease_id = $2::uuid`,
        [
          principal.organizationId,
          leaseId,
          nextState.status,
          nextState.totalDeductedVnd,
          nextState.totalRefundedVnd,
          nextState.remainingHeldVnd
        ]
      );

      if (deductionAmountVnd > 0) {
        await client.query(
          `INSERT INTO lease_deposit_movements (
             organization_id,
             lease_id,
             movement_type,
             amount_vnd,
             payment_method,
             reference,
             notes,
             occurred_at,
             created_by_user_id
           )
           VALUES ($1, $2, 'DEDUCTION', $3, 'OTHER', $4, $5, $6, $7)`,
          [
            principal.organizationId,
            leaseId,
            deductionAmountVnd,
            deductionReason,
            notes,
            occurredAt,
            principal.userId
          ]
        );
      }

      if (refundAmountVnd > 0) {
        await client.query(
          `INSERT INTO lease_deposit_movements (
             organization_id,
             lease_id,
             movement_type,
             amount_vnd,
             payment_method,
             reference,
             notes,
             occurred_at,
             created_by_user_id
           )
           VALUES ($1, $2, 'REFUND', $3, 'BANK_TRANSFER', $4, $5, $6, $7)`,
          [
            principal.organizationId,
            leaseId,
            refundAmountVnd,
            refundReference,
            notes,
            occurredAt,
            principal.userId
          ]
        );
      }

      // Automatically update termination deposit_readiness if remaining reaches zero
      if (nextState.remainingHeldVnd === 0) {
        await client.query(
          `UPDATE lease_terminations
           SET deposit_readiness = 'READY',
               status = CASE
                 WHEN (
                   meter_readiness <> 'PENDING'
                   AND financial_readiness <> 'PENDING'
                 ) THEN 'READY'
                 ELSE 'SCHEDULED'
               END,
               updated_at = now()
           WHERE organization_id = $1::uuid
             AND lease_id = $2::uuid
             AND status IN ('SCHEDULED', 'READY')`,
          [principal.organizationId, leaseId]
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
         VALUES ($1, $2, 'LEASE_DEPOSIT_SETTLED', 'LEASE', $3, $4::jsonb)`,
        [
          principal.organizationId,
          principal.userId,
          leaseId,
          JSON.stringify({
            deductionAmountVnd,
            refundAmountVnd,
            deductionReason,
            refundReference,
            totalDeductedVnd: nextState.totalDeductedVnd,
            totalRefundedVnd: nextState.totalRefundedVnd,
            remainingHeldVnd: nextState.remainingHeldVnd,
            status: nextState.status
          })
        ]
      );

      const summary = await this.getDepositSummary(
        client,
        principal.organizationId,
        leaseId,
        depositRequiredVnd
      );

      await repository.saveCommandReceipt({
        organizationId: principal.organizationId,
        idempotencyKey,
        commandType: "LEASE_DEPOSIT_SETTLE",
        leaseId,
        response: summary
      });

      return summary;
    });
  }

  private async loadLeaseContext(
    client: PoolClient,
    organizationId: string,
    leaseId: string
  ): Promise<LeaseContextRow> {
    const result = await client.query<LeaseContextRow>(
      `SELECT
         l.id::text AS lease_id,
         l.status AS lease_status,
         l.deposit_required_vnd::text,
         p.id::text AS property_id,
         COALESCE(
           array_agg(DISTINCT pog.operational_group_id::text)
             FILTER (WHERE pog.operational_group_id IS NOT NULL),
           '{}'::text[]
         ) AS operational_group_ids
       FROM leases l
       JOIN rooms r
         ON r.organization_id = l.organization_id
        AND r.id = l.room_id
       JOIN properties p
         ON p.organization_id = r.organization_id
        AND p.id = r.property_id
       LEFT JOIN property_operational_groups pog
         ON pog.organization_id = p.organization_id
        AND pog.property_id = p.id
       WHERE l.organization_id = $1::uuid
         AND l.id = $2::uuid
       GROUP BY l.id, l.status, l.deposit_required_vnd, p.id
       LIMIT 1`,
      [organizationId, leaseId]
    );

    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException("Lease was not found.");
    }

    return row;
  }

  private async getDepositStateForUpdate(
    client: PoolClient,
    organizationId: string,
    leaseId: string,
    depositRequiredVnd: number
  ): Promise<DepositState> {
    const result = await client.query<DepositRow>(
      `SELECT
         status,
         deposit_required_vnd::text,
         total_collected_vnd::text,
         total_deducted_vnd::text,
         total_refunded_vnd::text,
         remaining_held_vnd::text
       FROM lease_deposits
       WHERE organization_id = $1::uuid
         AND lease_id = $2::uuid
       FOR UPDATE`,
      [organizationId, leaseId]
    );

    const row = result.rows[0];
    if (row) {
      return {
        status: row.status,
        depositRequiredVnd: Number(row.deposit_required_vnd),
        totalCollectedVnd: Number(row.total_collected_vnd),
        totalDeductedVnd: Number(row.total_deducted_vnd),
        totalRefundedVnd: Number(row.total_refunded_vnd),
        remainingHeldVnd: Number(row.remaining_held_vnd)
      };
    }

    const initial = calculateDepositStatus(depositRequiredVnd, 0, 0, 0);
    return {
      status: initial.status,
      depositRequiredVnd,
      totalCollectedVnd: 0,
      totalDeductedVnd: 0,
      totalRefundedVnd: 0,
      remainingHeldVnd: initial.remainingHeldVnd
    };
  }

  private money(value: unknown, field: string): number {
    const num = Number(value);
    if (!Number.isSafeInteger(num) || num < 0) {
      throw new ConflictException(`${field} must be a non-negative integer in VND.`);
    }
    return num;
  }

  private requiredText(value: unknown, field: string): string {
    const normalized = String(value ?? "").trim();
    if (!normalized) {
      throw new ConflictException(`${field} is required.`);
    }
    return normalized;
  }

  private optionalText(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized || null;
  }

  private dateOnly(date: Date | null): string {
    if (!date) return "";
    return date.toISOString().slice(0, 10);
  }

  private dateOnlyString(value: string): string {
    const normalized = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      throw new ConflictException("Date must follow YYYY-MM-DD format.");
    }
    return normalized;
  }

  private currentDateString(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
