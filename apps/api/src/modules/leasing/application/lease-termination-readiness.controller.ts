import {
  BadRequestException,
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import { TenantPrincipalGuard } from "../../identity/tenant-principal.guard.js";
import type {
  TenantPrincipal,
  TenantRequest
} from "../../identity/tenant-principal.js";
import {
  LeaseTerminationReadinessService,
  type ReadinessKind,
  type ReadinessState
} from "./lease-termination-readiness.service.js";

type BodyInput = Record<string, unknown>;

@Controller("admin/leases")
@UseGuards(TenantPrincipalGuard)
export class LeaseTerminationReadinessController {
  constructor(private readonly readiness: LeaseTerminationReadinessService) {}

  @Post(":leaseId/termination/readiness")
  setReadiness(
    @Req() request: TenantRequest,
    @Param("leaseId", new ParseUUIDPipe({ version: "4" })) leaseId: string,
    @Body() input: BodyInput
  ) {
    const kind = input.kind;
    const state = input.state;
    const reason = input.reason;

    if (
      kind !== "meter" &&
      kind !== "financial" &&
      kind !== "deposit"
    ) {
      throw new BadRequestException("Invalid readiness kind.");
    }
    if (
      state !== "PENDING" &&
      state !== "READY" &&
      state !== "NOT_REQUIRED"
    ) {
      throw new BadRequestException("Invalid readiness state.");
    }
    if (typeof reason !== "string" || reason.trim().length === 0) {
      throw new BadRequestException("reason is required.");
    }

    return this.readiness.setManualReadiness(
      this.principal(request),
      leaseId,
      {
        kind: kind as ReadinessKind,
        state: state as ReadinessState,
        reason
      }
    );
  }

  @Post(":leaseId/termination/readiness/sync")
  syncReadiness(
    @Req() request: TenantRequest,
    @Param("leaseId", new ParseUUIDPipe({ version: "4" })) leaseId: string
  ) {
    return this.readiness.syncReadinessFromSystem(
      this.principal(request),
      leaseId
    );
  }

  @Post(":leaseId/termination/record-meter-reading")
  recordFinalMeterReading(
    @Req() request: TenantRequest,
    @Param("leaseId", new ParseUUIDPipe({ version: "4" })) leaseId: string,
    @Body() input: BodyInput
  ) {
    const meterId = input.meterId;
    const readingDate = input.readingDate;
    const readingValue = input.readingValue;

    if (typeof meterId !== "string" || meterId.trim().length === 0) {
      throw new BadRequestException("meterId is required.");
    }
    if (typeof readingDate !== "string" || readingDate.trim().length === 0) {
      throw new BadRequestException("readingDate is required.");
    }
    if (readingValue === undefined || readingValue === null || isNaN(Number(readingValue))) {
      throw new BadRequestException("readingValue must be a valid number.");
    }

    return this.readiness.recordFinalMeterReading(
      this.principal(request),
      leaseId,
      {
        meterId: meterId.trim(),
        readingDate: readingDate.trim(),
        readingValue: Number(readingValue)
      }
    );
  }

  private principal(request: TenantRequest): TenantPrincipal {
    if (!request.tenantPrincipal) {
      throw new Error("TenantPrincipalGuard did not attach a principal.");
    }
    return request.tenantPrincipal;
  }
}
