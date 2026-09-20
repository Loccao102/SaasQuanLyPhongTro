export type SubscriptionStatus =
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "GRACE_PERIOD"
  | "SUSPENDED"
  | "CANCELLED";

export type SubscriptionAccessMode = "FULL" | "READ_ONLY";

export interface SubscriptionState {
  id: string;
  organizationId: string;
  planId: string;
  planVersionId: string;
  status: SubscriptionStatus;
  version: number;
}

export interface SubscriptionDomainEvent {
  type: "SUBSCRIPTION_STATUS_CHANGED";
  organizationId: string;
  subscriptionId: string;
  payload: Readonly<{
    from: SubscriptionStatus;
    to: SubscriptionStatus;
    reason: string;
  }>;
}

export interface SubscriptionTransitionResult {
  subscription: SubscriptionState;
  events: readonly SubscriptionDomainEvent[];
}

export class InvalidSubscriptionTransitionError extends Error {
  constructor(from: SubscriptionStatus, to: SubscriptionStatus) {
    super(`Cannot transition subscription from ${from} to ${to}.`);
    this.name = "InvalidSubscriptionTransitionError";
  }
}

const allowedTransitions: Record<
  SubscriptionStatus,
  ReadonlySet<SubscriptionStatus>
> = {
  TRIALING: new Set(["ACTIVE", "CANCELLED"]),
  ACTIVE: new Set(["PAST_DUE", "CANCELLED"]),
  PAST_DUE: new Set(["ACTIVE", "GRACE_PERIOD", "CANCELLED"]),
  GRACE_PERIOD: new Set(["ACTIVE", "SUSPENDED", "CANCELLED"]),
  SUSPENDED: new Set(["ACTIVE", "CANCELLED"]),
  CANCELLED: new Set()
};

export function canTransitionSubscription(
  from: SubscriptionStatus,
  to: SubscriptionStatus
): boolean {
  return allowedTransitions[from].has(to);
}

export function transitionSubscription(
  subscription: SubscriptionState,
  to: SubscriptionStatus,
  reason: string
): SubscriptionTransitionResult {
  if (!canTransitionSubscription(subscription.status, to)) {
    throw new InvalidSubscriptionTransitionError(subscription.status, to);
  }

  const normalizedReason = reason.trim();
  if (normalizedReason.length < 3) {
    throw new Error("Subscription transition reason is required.");
  }

  const from = subscription.status;
  const next: SubscriptionState = {
    ...subscription,
    status: to,
    version: subscription.version + 1
  };

  return {
    subscription: next,
    events: [
      {
        type: "SUBSCRIPTION_STATUS_CHANGED",
        organizationId: next.organizationId,
        subscriptionId: next.id,
        payload: {
          from,
          to,
          reason: normalizedReason
        }
      }
    ]
  };
}

export function subscriptionAccessMode(
  status: SubscriptionStatus
): SubscriptionAccessMode {
  return status === "SUSPENDED" || status === "CANCELLED"
    ? "READ_ONLY"
    : "FULL";
}
