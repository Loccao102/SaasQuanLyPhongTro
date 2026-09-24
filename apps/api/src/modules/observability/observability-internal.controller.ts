import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards
} from "@nestjs/common";
import { InternalServiceGuard } from "../internal/internal-service.guard.js";
import { ObservabilityService } from "./observability.service.js";
import type {
  WorkerRole,
  WorkerStatus
} from "./observability.types.js";

type WorkerHeartbeatInput = {
  workerId?: string;
  role?: WorkerRole;
  provider?: string | null;
  status?: WorkerStatus;
  staleAfterSeconds?: number;
  lastErrorCode?: string | null;
  metadata?: unknown;
};

function requiredString(
  value: unknown,
  field: string,
  maxLength: number
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(field + " is required.");
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new BadRequestException(
      field + " must be at most " + String(maxLength) + " characters."
    );
  }
  return normalized;
}

@Controller("internal/observability")
@UseGuards(InternalServiceGuard)
export class ObservabilityInternalController {
  constructor(private readonly observability: ObservabilityService) {}

  @Post("heartbeat")
  async heartbeat(@Body() input: WorkerHeartbeatInput) {
    const workerId = requiredString(input.workerId, "workerId", 200);

    if (
      input.role !== "NOTIFICATION" &&
      input.role !== "BILLING" &&
      input.role !== "BILLING_WEBHOOK" &&
      input.role !== "RENTER_PAYMENT_WEBHOOK"
    ) {
      throw new BadRequestException("Invalid worker role.");
    }
    if (
      input.status !== "STARTING" &&
      input.status !== "HEALTHY" &&
      input.status !== "DEGRADED" &&
      input.status !== "STOPPING"
    ) {
      throw new BadRequestException("Invalid worker status.");
    }
    if (
      !Number.isInteger(input.staleAfterSeconds) ||
      Number(input.staleAfterSeconds) < 30 ||
      Number(input.staleAfterSeconds) > 86400
    ) {
      throw new BadRequestException(
        "staleAfterSeconds must be an integer between 30 and 86400."
      );
    }

    const provider =
      input.provider === undefined || input.provider === null
        ? null
        : requiredString(input.provider, "provider", 100);
    const lastErrorCode =
      input.lastErrorCode === undefined || input.lastErrorCode === null
        ? null
        : requiredString(input.lastErrorCode, "lastErrorCode", 100);

    if (
      input.metadata !== undefined &&
      (typeof input.metadata !== "object" ||
        input.metadata === null ||
        Array.isArray(input.metadata))
    ) {
      throw new BadRequestException("metadata must be an object.");
    }

    await this.observability.reportWorkerHeartbeat({
      workerId,
      role: input.role,
      provider,
      status: input.status,
      staleAfterSeconds: Number(input.staleAfterSeconds),
      lastErrorCode,
      metadata: input.metadata
    });

    return { ok: true };
  }
}
