export type LeaseStatus =
  | "DRAFT"
  | "ACTIVE"
  | "TERMINATION_SCHEDULED"
  | "TERMINATED"
  | "CANCELLED";

export type ReadinessState = "PENDING" | "READY" | "NOT_REQUIRED";

export interface LeaseState {
  id: string;
  organizationId: string;
  roomId: string;
  status: LeaseStatus;
  startDate: string;
  plannedEndDate: string | null;
  terminationEffectiveDate: string | null;
  terminationReason: string | null;
  version: number;
}

export interface TerminationReadiness {
  meter: ReadinessState;
  financial: ReadinessState;
  deposit: ReadinessState;
}

export interface LeaseDomainEvent {
  type:
    | "LEASE_ACTIVATED"
    | "LEASE_DRAFT_CANCELLED"
    | "LEASE_TERMINATION_SCHEDULED"
    | "LEASE_TERMINATION_CANCELLED"
    | "LEASE_TERMINATED"
    | "LEASE_RENEWED";

  organizationId: string;
  leaseId: string;
  roomId: string;
  payload: Readonly<Record<string, string | number | boolean | null>>;
}

export interface LeaseTransitionResult {
  lease: LeaseState;
  events: readonly LeaseDomainEvent[];
}

export class InvalidLeaseTransitionError extends Error {
  constructor(from: LeaseStatus, action: string) {
    super(`Cannot ${action} lease from status ${from}.`);
    this.name = "InvalidLeaseTransitionError";
  }
}

export class InvalidLeaseDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLeaseDateError";
  }
}

export class LeaseTerminationNotReadyError extends Error {
  constructor(readiness: TerminationReadiness) {
    const pending = Object.entries(readiness)
      .filter(([, value]) => value === "PENDING")
      .map(([key]) => key)
      .join(", ");

    super(`Lease termination is not ready: ${pending || "unknown readiness"}.`);
    this.name = "LeaseTerminationNotReadyError";
  }
}

function assertIsoDate(value: string, field: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    throw new InvalidLeaseDateError(`${field} must use YYYY-MM-DD.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new InvalidLeaseDateError(`${field} is not a valid calendar date.`);
  }
}

function event(
  lease: LeaseState,
  type: LeaseDomainEvent["type"],
  payload: LeaseDomainEvent["payload"] = {}
): LeaseDomainEvent {
  return {
    type,
    organizationId: lease.organizationId,
    leaseId: lease.id,
    roomId: lease.roomId,
    payload
  };
}

function bump(lease: LeaseState, patch: Partial<LeaseState>): LeaseState {
  return {
    ...lease,
    ...patch,
    version: lease.version + 1
  };
}

export function activateLease(lease: LeaseState): LeaseTransitionResult {
  if (lease.status !== "DRAFT") {
    throw new InvalidLeaseTransitionError(lease.status, "activate");
  }

  assertIsoDate(lease.startDate, "startDate");

  if (lease.plannedEndDate !== null) {
    assertIsoDate(lease.plannedEndDate, "plannedEndDate");

    if (lease.plannedEndDate < lease.startDate) {
      throw new InvalidLeaseDateError(
        "plannedEndDate cannot be earlier than startDate."
      );
    }
  }

  const next = bump(lease, { status: "ACTIVE" });

  return {
    lease: next,
    events: [event(next, "LEASE_ACTIVATED")]
  };
}

export function cancelDraftLease(lease: LeaseState): LeaseTransitionResult {
  if (lease.status !== "DRAFT") {
    throw new InvalidLeaseTransitionError(lease.status, "cancel draft");
  }

  const next = bump(lease, { status: "CANCELLED" });

  return {
    lease: next,
    events: [event(next, "LEASE_DRAFT_CANCELLED")]
  };
}

export function scheduleLeaseTermination(
  lease: LeaseState,
  input: { effectiveDate: string; reason: string }
): LeaseTransitionResult {
  if (lease.status !== "ACTIVE") {
    throw new InvalidLeaseTransitionError(lease.status, "schedule termination");
  }

  assertIsoDate(input.effectiveDate, "effectiveDate");

  if (input.effectiveDate < lease.startDate) {
    throw new InvalidLeaseDateError(
      "termination effectiveDate cannot be earlier than lease startDate."
    );
  }

  const reason = input.reason.trim();

  if (reason.length === 0) {
    throw new Error("Termination reason is required.");
  }

  const next = bump(lease, {
    status: "TERMINATION_SCHEDULED",
    terminationEffectiveDate: input.effectiveDate,
    terminationReason: reason
  });

  return {
    lease: next,
    events: [
      event(next, "LEASE_TERMINATION_SCHEDULED", {
        effectiveDate: input.effectiveDate,
        reason
      })
    ]
  };
}

export function cancelLeaseTermination(
  lease: LeaseState
): LeaseTransitionResult {
  if (lease.status !== "TERMINATION_SCHEDULED") {
    throw new InvalidLeaseTransitionError(
      lease.status,
      "cancel scheduled termination"
    );
  }

  const next = bump(lease, {
    status: "ACTIVE",
    terminationEffectiveDate: null,
    terminationReason: null
  });

  return {
    lease: next,
    events: [event(next, "LEASE_TERMINATION_CANCELLED")]
  };
}

export function terminationIsReady(
  readiness: TerminationReadiness
): boolean {
  return Object.values(readiness).every((value) => value !== "PENDING");
}

export function finalizeLeaseTermination(
  lease: LeaseState,
  readiness: TerminationReadiness
): LeaseTransitionResult {
  if (lease.status !== "TERMINATION_SCHEDULED") {
    throw new InvalidLeaseTransitionError(lease.status, "finalize termination");
  }

  if (!terminationIsReady(readiness)) {
    throw new LeaseTerminationNotReadyError(readiness);
  }

  const next = bump(lease, { status: "TERMINATED" });

  return {
    lease: next,
    events: [
      event(next, "LEASE_TERMINATED", {
        effectiveDate: next.terminationEffectiveDate,
        meterReady: readiness.meter !== "PENDING",
        financialReady: readiness.financial !== "PENDING",
        depositReady: readiness.deposit !== "PENDING"
      })
    ]
  };
}

export function renewLease(
  lease: LeaseState,
  input: { newPlannedEndDate: string }
): LeaseTransitionResult {
  if (lease.status !== "ACTIVE") {
    throw new InvalidLeaseTransitionError(lease.status, "renew");
  }

  assertIsoDate(input.newPlannedEndDate, "newPlannedEndDate");

  if (input.newPlannedEndDate <= lease.startDate) {
    throw new InvalidLeaseDateError(
      "newPlannedEndDate must be later than startDate."
    );
  }

  if (lease.plannedEndDate !== null && input.newPlannedEndDate <= lease.plannedEndDate) {
    throw new InvalidLeaseDateError(
      "newPlannedEndDate must be later than current plannedEndDate."
    );
  }

  const next = bump(lease, { plannedEndDate: input.newPlannedEndDate });

  return {
    lease: next,
    events: [
      event(next, "LEASE_RENEWED", {
        previousPlannedEndDate: lease.plannedEndDate,
        newPlannedEndDate: input.newPlannedEndDate
      })
    ]
  };
}

export function leaseOccupiesRoom(status: LeaseStatus): boolean {
  return status === "ACTIVE" || status === "TERMINATION_SCHEDULED";
}

