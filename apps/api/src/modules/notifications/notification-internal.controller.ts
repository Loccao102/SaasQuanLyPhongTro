import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
  UseGuards
} from "@nestjs/common";
import { NotificationOperationsService } from "./application/notification-operations.service.js";
import { NotificationWorkerService } from "./application/notification-worker.service.js";
import type { NotificationProviderResult } from "./domain/notification-provider.js";
import { InternalWorkerGuard } from "./internal-worker.guard.js";

type ClaimInput = {
  provider?: string;
};

type HeartbeatInput = {
  workerId?: string;
  provider?: string;
  status?: "STARTING" | "HEALTHY" | "DEGRADED" | "STOPPING";
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  metadata?: unknown;
  pauseProviderReason?: string | null;
};

type CompleteInput = {
  organizationId?: string;
  attemptNumber?: number;
  result?: unknown;
};

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(field + " is required.");
  }
  return value.trim();
}

function optionalEvidence(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequestException("result.evidence must be an object.");
  }
  return value as Readonly<Record<string, unknown>>;
}

function parseProviderResult(value: unknown): NotificationProviderResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequestException("result must be an object.");
  }

  const raw = value as Record<string, unknown>;
  const kind = requireNonEmptyString(raw.kind, "result.kind");
  const evidence = optionalEvidence(raw.evidence);

  switch (kind) {
    case "SENT_CONFIRMED":
      if (
        typeof raw.recipientVerified !== "boolean" ||
        typeof raw.sendVerified !== "boolean"
      ) {
        throw new BadRequestException(
          "SENT_CONFIRMED requires recipientVerified and sendVerified booleans."
        );
      }
      return {
        kind,
        recipientVerified: raw.recipientVerified,
        sendVerified: raw.sendVerified,
        providerReference:
          raw.providerReference === undefined || raw.providerReference === null
            ? null
            : requireNonEmptyString(
                raw.providerReference,
                "result.providerReference"
              ),
        evidence
      };
    case "TRANSIENT_FAILURE":
    case "PERMANENT_FAILURE":
      return {
        kind,
        errorCode: requireNonEmptyString(raw.errorCode, "result.errorCode"),
        errorMessage: requireNonEmptyString(
          raw.errorMessage,
          "result.errorMessage"
        ),
        evidence
      };
    case "MANUAL_REVIEW":
    case "UNKNOWN":
      return {
        kind,
        errorCode:
          raw.errorCode === undefined || raw.errorCode === null
            ? null
            : requireNonEmptyString(raw.errorCode, "result.errorCode"),
        errorMessage:
          raw.errorMessage === undefined || raw.errorMessage === null
            ? null
            : requireNonEmptyString(raw.errorMessage, "result.errorMessage"),
        evidence
      };
    default:
      throw new BadRequestException("Unknown notification provider result kind.");
  }
}

@Controller("internal/notifications")
@UseGuards(InternalWorkerGuard)
export class NotificationInternalController {
  constructor(
    private readonly worker: NotificationWorkerService,
    private readonly operations: NotificationOperationsService
  ) {}

  @Post("heartbeat")
  async heartbeat(@Body() input: HeartbeatInput) {
    const workerId = requireNonEmptyString(input.workerId, "workerId");
    const provider = requireNonEmptyString(input.provider, "provider");

    if (
      input.status !== "STARTING" &&
      input.status !== "HEALTHY" &&
      input.status !== "DEGRADED" &&
      input.status !== "STOPPING"
    ) {
      throw new BadRequestException("Invalid worker heartbeat status.");
    }

    await this.operations.reportHeartbeat({
      workerId,
      provider,
      status: input.status,
      lastErrorCode: input.lastErrorCode ?? null,
      lastErrorMessage: input.lastErrorMessage ?? null,
      metadata: input.metadata,
      pauseProviderReason: input.pauseProviderReason ?? null
    });

    return { ok: true };
  }

  @Post("claim")
  claim(@Body() input: ClaimInput) {
    const provider = requireNonEmptyString(input.provider, "provider");
    return this.worker.claimNext(provider);
  }

  @Post(":jobId/complete")
  complete(@Param("jobId") jobId: string, @Body() input: CompleteInput) {
    const organizationId = requireNonEmptyString(
      input.organizationId,
      "organizationId"
    );

    if (
      !Number.isInteger(input.attemptNumber) ||
      Number(input.attemptNumber) < 1
    ) {
      throw new BadRequestException(
        "attemptNumber must be a positive integer."
      );
    }

    return this.worker.completeAttempt({
      organizationId,
      jobId,
      attemptNumber: Number(input.attemptNumber),
      result: parseProviderResult(input.result)
    });
  }
}
