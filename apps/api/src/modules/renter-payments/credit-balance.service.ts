import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import { DatabaseService } from "../database/database.service.js";
import { AccessControlService } from "../identity/access-control.service.js";
import { roleHasPermission } from "../identity/domain/access-control.js";
import type { TenantPrincipal } from "../identity/tenant-principal.js";

// ── Row types ────────────────────────────────────────────────

type CreditBalanceRow = QueryResultRow & {
  organization_id: string;
  balance_vnd: string;
  updated_at: Date | string;
};

type CreditMovementRow = QueryResultRow & {
  id: string;
  organization_id: string;
  movement_type: CreditMovementType;
  amount_vnd: string;
  balance_after_vnd: string;
  invoice_id: string | null;
  payment_transaction_id: string | null;
  allocation_id: string | null;
  description: string | null;
  note: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  created_at: Date | string;
};

type RefundRow = QueryResultRow & {
  id: string;
  organization_id: string;
  credit_movement_id: string;
  amount_vnd: string;
  refund_method: string;
  recipient_name: string | null;
  recipient_account: string | null;
  note: string | null;
  status: string;
  created_by_user_id: string | null;
  created_by_name: string | null;
  created_at: Date | string;
  completed_at: Date | string | null;
};

// ── Public types ─────────────────────────────────────────────

export type CreditMovementType =
  | "OVERPAYMENT_CREDIT"
  | "CREDIT_APPLIED"
  | "MANUAL_CREDIT"
  | "MANUAL_DEBIT"
  | "REFUND_ISSUED"
  | "ALLOCATION_REVERSAL";

export interface CreditBalance {
  organizationId: string;
  balanceVnd: number;
  updatedAt: string;
}

export interface CreditMovement {
  id: string;
  organizationId: string;
  movementType: CreditMovementType;
  amountVnd: number;
  balanceAfterVnd: number;
  invoiceId: string | null;
  paymentTransactionId: string | null;
  allocationId: string | null;
  description: string | null;
  note: string | null;
  createdByUserId: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface Refund {
  id: string;
  organizationId: string;
  creditMovementId: string;
  amountVnd: number;
  refundMethod: string;
  recipientName: string | null;
  recipientAccount: string | null;
  note: string | null;
  status: string;
  createdByUserId: string | null;
  createdByName: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface CreateManualCreditInput {
  movementId: string;
  amountVnd: number;
  description?: string | null;
  note?: string | null;
}

export interface CreateManualDebitInput {
  movementId: string;
  amountVnd: number;
  description?: string | null;
  note?: string | null;
}

export interface IssueRefundInput {
  refundId: string;
  movementId: string;
  amountVnd: number;
  refundMethod: "CASH" | "BANK_TRANSFER" | "OTHER";
  recipientName?: string | null;
  recipientAccount?: string | null;
  note?: string | null;
}

// ── Service ──────────────────────────────────────────────────

@Injectable()
export class CreditBalanceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly accessControl: AccessControlService
  ) {}

  // ── Queries ──────────────────────────────────────────────

  async getBalance(principal: TenantPrincipal): Promise<CreditBalance> {
    this.requirePermission(principal, "payment.read");

    const result = await this.db.query<CreditBalanceRow>(
      `SELECT
         organization_id::text,
         balance_vnd::text,
         updated_at
       FROM renter_credit_balances
       WHERE organization_id = $1::uuid`,
      [principal.organizationId]
    );

    if (!result.rows[0]) {
      return {
        organizationId: principal.organizationId,
        balanceVnd: 0,
        updatedAt: new Date().toISOString()
      };
    }

    return this.mapBalance(result.rows[0]);
  }

  async listMovements(
    principal: TenantPrincipal,
    filters: {
      movementType?: CreditMovementType | null;
      fromDate?: string | null;
      toDate?: string | null;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ movements: CreditMovement[]; total: number }> {
    this.requirePermission(principal, "payment.read");

    const conditions: string[] = ["m.organization_id = $1::uuid"];
    const values: unknown[] = [principal.organizationId];
    let idx = 2;

    if (filters.movementType) {
      conditions.push(`m.movement_type = $${idx++}`);
      values.push(filters.movementType);
    }
    if (filters.fromDate) {
      conditions.push(`m.created_at >= $${idx++}::timestamptz`);
      values.push(filters.fromDate);
    }
    if (filters.toDate) {
      conditions.push(`m.created_at <= $${idx++}::timestamptz`);
      values.push(filters.toDate);
    }

    const whereClause = conditions.join(" AND ");
    const limit = Math.min(Math.max(Number(filters.limit ?? 50), 1), 200);
    const offset = Math.max(Number(filters.offset ?? 0), 0);

    const countResult = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM renter_credit_movements m WHERE ${whereClause}`,
      values
    );
    const total = Number(countResult.rows[0]?.count ?? 0);

    const result = await this.db.query<CreditMovementRow>(
      `SELECT
         m.id::text,
         m.organization_id::text,
         m.movement_type,
         m.amount_vnd::text,
         m.balance_after_vnd::text,
         m.invoice_id::text,
         m.payment_transaction_id::text,
         m.allocation_id::text,
         m.description,
         m.note,
         m.created_by_user_id::text,
         u.full_name AS created_by_name,
         m.created_at
       FROM renter_credit_movements m
       LEFT JOIN users u ON u.id = m.created_by_user_id
       WHERE ${whereClause}
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, limit, offset]
    );

    return {
      movements: result.rows.map((row) => this.mapMovement(row)),
      total
    };
  }

  async listRefunds(
    principal: TenantPrincipal,
    filters: {
      limit?: number;
      offset?: number;
    }
  ): Promise<{ refunds: Refund[]; total: number }> {
    this.requirePermission(principal, "payment.read");

    const limit = Math.min(Math.max(Number(filters.limit ?? 50), 1), 200);
    const offset = Math.max(Number(filters.offset ?? 0), 0);

    const countResult = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM renter_refunds
       WHERE organization_id = $1::uuid`,
      [principal.organizationId]
    );

    const result = await this.db.query<RefundRow>(
      `SELECT
         r.id::text,
         r.organization_id::text,
         r.credit_movement_id::text,
         r.amount_vnd::text,
         r.refund_method,
         r.recipient_name,
         r.recipient_account,
         r.note,
         r.status,
         r.created_by_user_id::text,
         u.full_name AS created_by_name,
         r.created_at,
         r.completed_at
       FROM renter_refunds r
       LEFT JOIN users u ON u.id = r.created_by_user_id
       WHERE r.organization_id = $1::uuid
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT $2 OFFSET $3`,
      [principal.organizationId, limit, offset]
    );

    return {
      refunds: result.rows.map((row) => this.mapRefund(row)),
      total: Number(countResult.rows[0]?.count ?? 0)
    };
  }

  // ── Commands ─────────────────────────────────────────────

  /**
   * Record overpayment as credit. Called internally when a payment
   * allocation results in excess funds.
   */
  async recordOverpaymentCredit(
    client: PoolClient,
    organizationId: string,
    amountVnd: number,
    invoiceId: string | null,
    paymentTransactionId: string | null,
    allocationId: string | null,
    userId: string | null,
    movementId: string
  ): Promise<CreditMovement> {
    if (amountVnd <= 0) {
      throw new ConflictException("Overpayment credit must be positive.");
    }

    const currentBalance = await this.ensureBalanceRow(client, organizationId);
    const newBalance = currentBalance + amountVnd;

    await this.updateBalance(client, organizationId, newBalance);

    return this.insertMovement(client, {
      id: movementId,
      organizationId,
      movementType: "OVERPAYMENT_CREDIT",
      amountVnd,
      balanceAfterVnd: newBalance,
      invoiceId,
      paymentTransactionId,
      allocationId,
      description: "Số tiền thanh toán vượt mức hóa đơn được ghi nhận là tín dụng",
      note: null,
      createdByUserId: userId
    });
  }

  /**
   * Apply credit to an invoice. Called when billing finalizes
   * and there is available credit.
   */
  async applyCredit(
    client: PoolClient,
    organizationId: string,
    amountVnd: number,
    invoiceId: string,
    userId: string | null,
    movementId: string
  ): Promise<CreditMovement> {
    if (amountVnd <= 0) {
      throw new ConflictException("Credit application amount must be positive.");
    }

    const currentBalance = await this.ensureBalanceRow(client, organizationId);
    if (amountVnd > currentBalance) {
      throw new ConflictException(
        "Insufficient credit balance. Available: " +
          String(currentBalance) +
          " VND, requested: " +
          String(amountVnd) +
          " VND."
      );
    }

    const newBalance = currentBalance - amountVnd;
    await this.updateBalance(client, organizationId, newBalance);

    return this.insertMovement(client, {
      id: movementId,
      organizationId,
      movementType: "CREDIT_APPLIED",
      amountVnd: -amountVnd,
      balanceAfterVnd: newBalance,
      invoiceId,
      paymentTransactionId: null,
      allocationId: null,
      description: "Tín dụng được áp dụng vào hóa đơn",
      note: null,
      createdByUserId: userId
    });
  }

  /**
   * Manual credit granted by admin.
   */
  async createManualCredit(
    principal: TenantPrincipal,
    input: CreateManualCreditInput
  ): Promise<{ balance: CreditBalance; movement: CreditMovement }> {
    this.requirePermission(principal, "payment.reconcile");

    const amountVnd = this.money(input.amountVnd, "amountVnd");
    if (amountVnd <= 0) {
      throw new ConflictException("Manual credit amount must be positive.");
    }

    return this.db.withTransaction(async (client) => {
      const currentBalance = await this.ensureBalanceRow(
        client,
        principal.organizationId
      );
      const newBalance = currentBalance + amountVnd;

      await this.updateBalance(client, principal.organizationId, newBalance);

      // Check idempotency
      const existing = await client.query<CreditMovementRow>(
        `SELECT id::text FROM renter_credit_movements
         WHERE id = $1::uuid AND organization_id = $2::uuid`,
        [input.movementId, principal.organizationId]
      );
      if (existing.rows[0]) {
        const balance = await this.getBalanceWithClient(client, principal.organizationId);
        const movements = await client.query<CreditMovementRow>(
          `SELECT m.*, u.full_name AS created_by_name
           FROM renter_credit_movements m
           LEFT JOIN users u ON u.id = m.created_by_user_id
           WHERE m.id = $1::uuid`,
          [input.movementId]
        );
        return {
          balance,
          movement: this.mapMovement(movements.rows[0]!)
        };
      }

      const movement = await this.insertMovement(client, {
        id: input.movementId,
        organizationId: principal.organizationId,
        movementType: "MANUAL_CREDIT",
        amountVnd,
        balanceAfterVnd: newBalance,
        invoiceId: null,
        paymentTransactionId: null,
        allocationId: null,
        description: input.description?.trim() || "Cộng tín dụng thủ công",
        note: input.note?.trim() || null,
        createdByUserId: principal.userId
      });

      await this.audit(client, principal, "RENTER_CREDIT_MANUAL_ADDED", "CREDIT_BALANCE", principal.organizationId, {
        movementId: input.movementId,
        amountVnd,
        newBalance
      });

      const balance = await this.getBalanceWithClient(client, principal.organizationId);
      return { balance, movement };
    });
  }

  /**
   * Manual debit by admin (reduces credit).
   */
  async createManualDebit(
    principal: TenantPrincipal,
    input: CreateManualDebitInput
  ): Promise<{ balance: CreditBalance; movement: CreditMovement }> {
    this.requirePermission(principal, "payment.reconcile");

    const amountVnd = this.money(input.amountVnd, "amountVnd");
    if (amountVnd <= 0) {
      throw new ConflictException("Manual debit amount must be positive.");
    }

    return this.db.withTransaction(async (client) => {
      const currentBalance = await this.ensureBalanceRow(
        client,
        principal.organizationId
      );
      if (amountVnd > currentBalance) {
        throw new ConflictException(
          "Số dư tín dụng không đủ. Hiện có: " +
            this.formatVnd(currentBalance) +
            ", yêu cầu trừ: " +
            this.formatVnd(amountVnd)
        );
      }

      const newBalance = currentBalance - amountVnd;
      await this.updateBalance(client, principal.organizationId, newBalance);

      // Check idempotency
      const existing = await client.query<CreditMovementRow>(
        `SELECT id::text FROM renter_credit_movements
         WHERE id = $1::uuid AND organization_id = $2::uuid`,
        [input.movementId, principal.organizationId]
      );
      if (existing.rows[0]) {
        const balance = await this.getBalanceWithClient(client, principal.organizationId);
        const movements = await client.query<CreditMovementRow>(
          `SELECT m.*, u.full_name AS created_by_name
           FROM renter_credit_movements m
           LEFT JOIN users u ON u.id = m.created_by_user_id
           WHERE m.id = $1::uuid`,
          [input.movementId]
        );
        return {
          balance,
          movement: this.mapMovement(movements.rows[0]!)
        };
      }

      const movement = await this.insertMovement(client, {
        id: input.movementId,
        organizationId: principal.organizationId,
        movementType: "MANUAL_DEBIT",
        amountVnd: -amountVnd,
        balanceAfterVnd: newBalance,
        invoiceId: null,
        paymentTransactionId: null,
        allocationId: null,
        description: input.description?.trim() || "Trừ tín dụng thủ công",
        note: input.note?.trim() || null,
        createdByUserId: principal.userId
      });

      await this.audit(client, principal, "RENTER_CREDIT_MANUAL_DEDUCTED", "CREDIT_BALANCE", principal.organizationId, {
        movementId: input.movementId,
        amountVnd,
        newBalance
      });

      const balance = await this.getBalanceWithClient(client, principal.organizationId);
      return { balance, movement };
    });
  }

  /**
   * Issue refund from credit balance.
   */
  async issueRefund(
    principal: TenantPrincipal,
    input: IssueRefundInput
  ): Promise<{ balance: CreditBalance; movement: CreditMovement; refund: Refund }> {
    this.requirePermission(principal, "payment.reconcile");

    const amountVnd = this.money(input.amountVnd, "amountVnd");
    if (amountVnd <= 0) {
      throw new ConflictException("Refund amount must be positive.");
    }

    return this.db.withTransaction(async (client) => {
      // Check refund idempotency
      const existingRefund = await client.query<RefundRow>(
        `SELECT r.*, u.full_name AS created_by_name
         FROM renter_refunds r
         LEFT JOIN users u ON u.id = r.created_by_user_id
         WHERE r.id = $1::uuid AND r.organization_id = $2::uuid`,
        [input.refundId, principal.organizationId]
      );
      if (existingRefund.rows[0]) {
        const balance = await this.getBalanceWithClient(client, principal.organizationId);
        const mvt = await client.query<CreditMovementRow>(
          `SELECT m.*, u.full_name AS created_by_name
           FROM renter_credit_movements m
           LEFT JOIN users u ON u.id = m.created_by_user_id
           WHERE m.id = $1::uuid`,
          [input.movementId]
        );
        return {
          balance,
          movement: this.mapMovement(mvt.rows[0]!),
          refund: this.mapRefund(existingRefund.rows[0])
        };
      }

      const currentBalance = await this.ensureBalanceRow(
        client,
        principal.organizationId
      );
      if (amountVnd > currentBalance) {
        throw new ConflictException(
          "Số dư tín dụng không đủ để hoàn trả. Hiện có: " +
            this.formatVnd(currentBalance) +
            ", yêu cầu hoàn: " +
            this.formatVnd(amountVnd)
        );
      }

      const newBalance = currentBalance - amountVnd;
      await this.updateBalance(client, principal.organizationId, newBalance);

      const movement = await this.insertMovement(client, {
        id: input.movementId,
        organizationId: principal.organizationId,
        movementType: "REFUND_ISSUED",
        amountVnd: -amountVnd,
        balanceAfterVnd: newBalance,
        invoiceId: null,
        paymentTransactionId: null,
        allocationId: null,
        description: "Hoàn trả tín dụng cho khách thuê",
        note: input.note?.trim() || null,
        createdByUserId: principal.userId
      });

      const now = new Date();
      await client.query(
        `INSERT INTO renter_refunds (
           id, organization_id, credit_movement_id,
           amount_vnd, refund_method,
           recipient_name, recipient_account,
           note, status,
           created_by_user_id, created_at, completed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'COMPLETED', $9, $10, $10)`,
        [
          input.refundId,
          principal.organizationId,
          input.movementId,
          amountVnd,
          input.refundMethod,
          input.recipientName?.trim() || null,
          input.recipientAccount?.trim() || null,
          input.note?.trim() || null,
          principal.userId,
          now
        ]
      );

      const refundResult = await client.query<RefundRow>(
        `SELECT r.*, u.full_name AS created_by_name
         FROM renter_refunds r
         LEFT JOIN users u ON u.id = r.created_by_user_id
         WHERE r.id = $1::uuid`,
        [input.refundId]
      );

      await this.audit(client, principal, "RENTER_REFUND_ISSUED", "RENTER_REFUND", input.refundId, {
        movementId: input.movementId,
        amountVnd,
        refundMethod: input.refundMethod,
        recipientName: input.recipientName,
        newBalance
      });

      const balance = await this.getBalanceWithClient(client, principal.organizationId);
      return {
        balance,
        movement,
        refund: this.mapRefund(refundResult.rows[0]!)
      };
    });
  }

  /**
   * Reverse a payment allocation and convert to credit.
   */
  async reverseAllocation(
    principal: TenantPrincipal,
    allocationId: string,
    movementId: string
  ): Promise<{ balance: CreditBalance; movement: CreditMovement }> {
    this.requirePermission(principal, "payment.reconcile");

    return this.db.withTransaction(async (client) => {
      // Check idempotency on movement
      const existingMvt = await client.query<CreditMovementRow>(
        `SELECT m.*, u.full_name AS created_by_name
         FROM renter_credit_movements m
         LEFT JOIN users u ON u.id = m.created_by_user_id
         WHERE m.id = $1::uuid AND m.organization_id = $2::uuid`,
        [movementId, principal.organizationId]
      );
      if (existingMvt.rows[0]) {
        const balance = await this.getBalanceWithClient(client, principal.organizationId);
        return {
          balance,
          movement: this.mapMovement(existingMvt.rows[0])
        };
      }

      // Load the allocation
      const allocResult = await client.query<QueryResultRow & {
        id: string;
        organization_id: string;
        payment_transaction_id: string;
        invoice_id: string;
        amount_vnd: string;
      }>(
        `SELECT
           id::text,
           organization_id::text,
           payment_transaction_id::text,
           invoice_id::text,
           amount_vnd::text
         FROM renter_payment_allocations
         WHERE organization_id = $1::uuid
           AND id = $2::uuid
         FOR UPDATE`,
        [principal.organizationId, allocationId]
      );
      const allocation = allocResult.rows[0];
      if (!allocation) {
        throw new NotFoundException("Phân bổ thanh toán không tồn tại.");
      }

      const allocationAmountVnd = Number(allocation.amount_vnd);

      // Reverse: reduce invoice paid_vnd and update collection_status
      const invoiceResult = await client.query<QueryResultRow & {
        total_vnd: string;
        paid_vnd: string;
      }>(
        `SELECT total_vnd::text, paid_vnd::text
         FROM renter_invoices
         WHERE organization_id = $1::uuid AND id = $2::uuid
         FOR UPDATE`,
        [principal.organizationId, allocation.invoice_id]
      );
      const invoice = invoiceResult.rows[0];
      if (!invoice) {
        throw new NotFoundException("Hóa đơn không tồn tại.");
      }

      const newPaidVnd = Number(invoice.paid_vnd) - allocationAmountVnd;
      const totalVnd = Number(invoice.total_vnd);
      const newRemainingVnd = totalVnd - Math.max(0, newPaidVnd);
      const newCollectionStatus =
        newPaidVnd <= 0
          ? "UNPAID"
          : newPaidVnd >= totalVnd
            ? "PAID"
            : "PARTIALLY_PAID";

      // Delete the allocation
      await client.query(
        `DELETE FROM renter_payment_allocations
         WHERE organization_id = $1::uuid AND id = $2::uuid`,
        [principal.organizationId, allocationId]
      );

      // Update invoice projections
      await client.query(
        `UPDATE renter_invoices
         SET paid_vnd = $3,
             remaining_vnd = $4,
             collection_status = $5,
             updated_at = now()
         WHERE organization_id = $1::uuid AND id = $2::uuid`,
        [
          principal.organizationId,
          allocation.invoice_id,
          Math.max(0, newPaidVnd),
          newRemainingVnd,
          newCollectionStatus
        ]
      );

      // Credit the reversed amount
      const currentBalance = await this.ensureBalanceRow(
        client,
        principal.organizationId
      );
      const newBalance = currentBalance + allocationAmountVnd;
      await this.updateBalance(client, principal.organizationId, newBalance);

      const movement = await this.insertMovement(client, {
        id: movementId,
        organizationId: principal.organizationId,
        movementType: "ALLOCATION_REVERSAL",
        amountVnd: allocationAmountVnd,
        balanceAfterVnd: newBalance,
        invoiceId: allocation.invoice_id,
        paymentTransactionId: allocation.payment_transaction_id,
        allocationId,
        description: "Đảo ngược phân bổ thanh toán — số tiền chuyển thành tín dụng",
        note: null,
        createdByUserId: principal.userId
      });

      await this.audit(client, principal, "RENTER_ALLOCATION_REVERSED", "RENTER_PAYMENT_ALLOCATION", allocationId, {
        movementId,
        allocationAmountVnd,
        invoiceId: allocation.invoice_id,
        paymentTransactionId: allocation.payment_transaction_id,
        newInvoicePaidVnd: Math.max(0, newPaidVnd),
        newInvoiceCollectionStatus: newCollectionStatus,
        newCreditBalance: newBalance
      });

      const balance = await this.getBalanceWithClient(client, principal.organizationId);
      return { balance, movement };
    });
  }

  // ── Internal helpers ─────────────────────────────────────

  private async ensureBalanceRow(
    client: PoolClient,
    organizationId: string
  ): Promise<number> {
    const result = await client.query<CreditBalanceRow>(
      `SELECT balance_vnd::text
       FROM renter_credit_balances
       WHERE organization_id = $1::uuid
       FOR UPDATE`,
      [organizationId]
    );
    if (result.rows[0]) {
      return Number(result.rows[0].balance_vnd);
    }
    // Initialize with zero
    await client.query(
      `INSERT INTO renter_credit_balances (organization_id, balance_vnd)
       VALUES ($1::uuid, 0)
       ON CONFLICT (organization_id) DO NOTHING`,
      [organizationId]
    );
    return 0;
  }

  private async updateBalance(
    client: PoolClient,
    organizationId: string,
    newBalanceVnd: number
  ): Promise<void> {
    await client.query(
      `UPDATE renter_credit_balances
       SET balance_vnd = $2, updated_at = now()
       WHERE organization_id = $1::uuid`,
      [organizationId, newBalanceVnd]
    );
  }

  private async getBalanceWithClient(
    client: PoolClient,
    organizationId: string
  ): Promise<CreditBalance> {
    const result = await client.query<CreditBalanceRow>(
      `SELECT
         organization_id::text,
         balance_vnd::text,
         updated_at
       FROM renter_credit_balances
       WHERE organization_id = $1::uuid`,
      [organizationId]
    );
    if (!result.rows[0]) {
      return {
        organizationId,
        balanceVnd: 0,
        updatedAt: new Date().toISOString()
      };
    }
    return this.mapBalance(result.rows[0]);
  }

  private async insertMovement(
    client: PoolClient,
    data: {
      id: string;
      organizationId: string;
      movementType: CreditMovementType;
      amountVnd: number;
      balanceAfterVnd: number;
      invoiceId: string | null;
      paymentTransactionId: string | null;
      allocationId: string | null;
      description: string | null;
      note: string | null;
      createdByUserId: string | null;
    }
  ): Promise<CreditMovement> {
    await client.query(
      `INSERT INTO renter_credit_movements (
         id, organization_id, movement_type,
         amount_vnd, balance_after_vnd,
         invoice_id, payment_transaction_id, allocation_id,
         description, note, created_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        data.id,
        data.organizationId,
        data.movementType,
        data.amountVnd,
        data.balanceAfterVnd,
        data.invoiceId,
        data.paymentTransactionId,
        data.allocationId,
        data.description,
        data.note,
        data.createdByUserId
      ]
    );

    return {
      id: data.id,
      organizationId: data.organizationId,
      movementType: data.movementType,
      amountVnd: data.amountVnd,
      balanceAfterVnd: data.balanceAfterVnd,
      invoiceId: data.invoiceId,
      paymentTransactionId: data.paymentTransactionId,
      allocationId: data.allocationId,
      description: data.description,
      note: data.note,
      createdByUserId: data.createdByUserId,
      createdByName: null,
      createdAt: new Date().toISOString()
    };
  }

  // ── Mappers ──────────────────────────────────────────────

  private mapBalance(row: CreditBalanceRow): CreditBalance {
    return {
      organizationId: row.organization_id,
      balanceVnd: Number(row.balance_vnd),
      updatedAt: this.timestamp(row.updated_at)
    };
  }

  private mapMovement(row: CreditMovementRow): CreditMovement {
    return {
      id: row.id,
      organizationId: row.organization_id,
      movementType: row.movement_type,
      amountVnd: Number(row.amount_vnd),
      balanceAfterVnd: Number(row.balance_after_vnd),
      invoiceId: row.invoice_id,
      paymentTransactionId: row.payment_transaction_id,
      allocationId: row.allocation_id,
      description: row.description,
      note: row.note,
      createdByUserId: row.created_by_user_id,
      createdByName: row.created_by_name,
      createdAt: this.timestamp(row.created_at)
    };
  }

  private mapRefund(row: RefundRow): Refund {
    return {
      id: row.id,
      organizationId: row.organization_id,
      creditMovementId: row.credit_movement_id,
      amountVnd: Number(row.amount_vnd),
      refundMethod: row.refund_method,
      recipientName: row.recipient_name,
      recipientAccount: row.recipient_account,
      note: row.note,
      status: row.status,
      createdByUserId: row.created_by_user_id,
      createdByName: row.created_by_name,
      createdAt: this.timestamp(row.created_at),
      completedAt: row.completed_at ? this.timestamp(row.completed_at) : null
    };
  }

  // ── Utilities ────────────────────────────────────────────

  private requirePermission(
    principal: TenantPrincipal,
    permission: "payment.read" | "payment.reconcile"
  ) {
    if (!roleHasPermission(principal.role, permission)) {
      throw new ForbiddenException("Permission denied: " + permission);
    }
    if (
      !this.accessControl.can(principal.membership, permission, {
        organizationId: principal.organizationId
      })
    ) {
      throw new ForbiddenException(
        "Organization scope denied for: " + permission
      );
    }
  }

  private money(value: number, field: string): number {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ConflictException(
        field + " must be a non-negative safe integer VND amount."
      );
    }
    return value;
  }

  private formatVnd(amount: number): string {
    return amount.toLocaleString("vi-VN") + " ₫";
  }

  private timestamp(value: Date | string): string {
    return value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();
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
