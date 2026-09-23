import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import { CommercialPolicyService } from "../../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../../database/database.service.js";
import { AccessControlService } from "../../identity/access-control.service.js";
import type {
  MembershipAccess,
  Permission
} from "../../identity/domain/access-control.js";
import {
  activateLease,
  cancelDraftLease,
  cancelLeaseTermination,
  finalizeLeaseTermination,
  scheduleLeaseTermination,
  type LeaseState,
  type LeaseTransitionResult
} from "../domain/lease-lifecycle.js";
import {
  assertReceiptMatches,
  normalizeIdempotencyKey
} from "./idempotent-command.js";
import {
  PostgresLeaseRepository,
  type LeaseResourceContext
} from "../infrastructure/postgres-lease-repository.js";

export interface LeaseActor {
  userId: string;
  membership: MembershipAccess;
}

interface LeaseCommandInput {
  actor: LeaseActor;
  organizationId: string;
  leaseId: string;
  idempotencyKey: string;
}

export interface LeaseCommandResponse {
  lease: LeaseState;
}

export class LeaseNotFoundError extends Error {
  constructor() {
    super("Lease was not found in the current organization.");
    this.name = "LeaseNotFoundError";
  }
}

export class LeaseAuthorizationError extends Error {
  constructor() {
    super("Principal is not authorized for this lease action.");
    this.name = "LeaseAuthorizationError";
  }
}

export class LeaseTerminationRecordNotFoundError extends Error {
  constructor() {
    super("Open lease termination workflow was not found.");
    this.name = "LeaseTerminationRecordNotFoundError";
  }
}

export class LeaseRoomOccupancyConflictError extends Error {
  constructor() {
    super("Room already has another current lease.");
    this.name = "LeaseRoomOccupancyConflictError";
  }
}

@Injectable()
export class LeaseLifecycleApplicationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly accessControl: AccessControlService,
    private readonly commercialPolicy: CommercialPolicyService
  ) {}

  async activate(input: LeaseCommandInput): Promise<LeaseCommandResponse> {
    return this.runCommand(
      input,
      "LEASE_ACTIVATE",
      "lease.manage",
      async (_repository, context) => activateLease(context.lease)
    );
  }

  async cancelDraft(input: LeaseCommandInput): Promise<LeaseCommandResponse> {
    return this.runCommand(
      input,
      "LEASE_DRAFT_CANCEL",
      "lease.manage",
      async (_repository, context) => cancelDraftLease(context.lease)
    );
  }

  async scheduleTermination(
    input: LeaseCommandInput & { effectiveDate: string; reason: string }
  ): Promise<LeaseCommandResponse> {
    return this.runCommand(
      input,
      "LEASE_TERMINATION_SCHEDULE",
      "lease.terminate",
      async (repository, context) => {
        const transition = scheduleLeaseTermination(context.lease, {
          effectiveDate: input.effectiveDate,
          reason: input.reason
        });

        await repository.createTermination({
          organizationId: input.organizationId,
          leaseId: input.leaseId,
          effectiveDate:
            transition.lease.terminationEffectiveDate ?? input.effectiveDate,
          reason: transition.lease.terminationReason ?? input.reason,
          actorUserId: input.actor.userId
        });

        return transition;
      }
    );
  }

  async cancelTermination(
    input: LeaseCommandInput
  ): Promise<LeaseCommandResponse> {
    return this.runCommand(
      input,
      "LEASE_TERMINATION_CANCEL",
      "lease.terminate",
      async (repository, context) => {
        const transition = cancelLeaseTermination(context.lease);
        const cancelled = await repository.cancelOpenTermination(
          input.organizationId,
          input.leaseId,
          input.actor.userId
        );

        if (!cancelled) {
          throw new LeaseTerminationRecordNotFoundError();
        }

        return transition;
      }
    );
  }

  async finalizeTermination(
    input: LeaseCommandInput
  ): Promise<LeaseCommandResponse> {
    return this.runCommand(
      input,
      "LEASE_TERMINATION_FINALIZE",
      "lease.terminate",
      async (repository, context) => {
        const readiness =
          await repository.getOpenTerminationReadinessForUpdate(
            input.organizationId,
            input.leaseId
          );

        if (!readiness) {
          throw new LeaseTerminationRecordNotFoundError();
        }

        const transition = finalizeLeaseTermination(
          context.lease,
          readiness
        );

        const completed = await repository.completeOpenTermination(
          input.organizationId,
          input.leaseId,
          input.actor.userId
        );

        if (!completed) {
          throw new LeaseTerminationRecordNotFoundError();
        }

        return transition;
      }
    );
  }

  private async runCommand(
    input: LeaseCommandInput,
    commandType: string,
    permission: Permission,
    operation: (
      repository: PostgresLeaseRepository,
      context: LeaseResourceContext
    ) => Promise<LeaseTransitionResult>
  ): Promise<LeaseCommandResponse> {
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);

    return this.database.withTransaction(async (client: PoolClient) => {
      const repository = new PostgresLeaseRepository(client);
      const context = await repository.findLeaseForUpdate(
        input.organizationId,
        input.leaseId
      );

      if (!context) {
        throw new LeaseNotFoundError();
      }

      const authorized = this.accessControl.can(
        input.actor.membership,
        permission,
        {
          organizationId: context.lease.organizationId,
          propertyId: context.propertyId,
          operationalGroupIds: context.operationalGroupIds
        }
      );

      if (!authorized) {
        throw new LeaseAuthorizationError();
      }

      const receipt = await repository.findCommandReceipt(
        input.organizationId,
        idempotencyKey
      );

      if (receipt) {
        assertReceiptMatches(receipt, {
          commandType,
          leaseId: input.leaseId
        });

        return receipt.response as LeaseCommandResponse;
      }

      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        input.organizationId
      );

      const previousVersion = context.lease.version;
      const transition = await operation(repository, context);

      try {
        await repository.updateLease(
          transition.lease,
          previousVersion,
          input.actor.userId
        );
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code?: string }).code === "23505" &&
          "constraint" in error &&
          (error as { constraint?: string }).constraint ===
            "leases_one_current_per_room_uidx"
        ) {
          throw new LeaseRoomOccupancyConflictError();
        }
        throw error;
      }

      await repository.appendAuditEvents(
        input.actor.userId,
        transition.lease.version,
        transition.events
      );

      const response: LeaseCommandResponse = {
        lease: transition.lease
      };

      await repository.saveCommandReceipt({
        organizationId: input.organizationId,
        idempotencyKey,
        commandType,
        leaseId: input.leaseId,
        response
      });

      return response;
    });
  }
}
