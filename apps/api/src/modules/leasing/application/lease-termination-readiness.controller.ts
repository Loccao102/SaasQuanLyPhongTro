import {
  BadRequestException,
  Body,
  Controller,
  Get,
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

  @Get(":leaseId/termination/meter-readiness")
  meterReadiness(
    @Req() request: TenantRequest,
    @Param("leaseId", new ParseUUIDPipe({ version: "4" })) leaseId: string
  ) {
    return this.readiness.meterReadiness(
      this.principal(request),
      leaseId
    );
  }

  @Get(":leaseId/termination/financial-readiness")
  financialReadiness(
    @Req() request: TenantRequest,
    @Param("leaseId", new ParseUUIDPipe({ version: "4" })) leaseId: string
  ) {
    return this.readiness.financialReadiness(
      this.principal(request),
      leaseId
    );
  }

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

  private principal(request: TenantRequest): TenantPrincipal {
    if (!request.tenantPrincipal) {
      throw new Error("TenantPrincipalGuard did not attach a principal.");
    }
    return request.tenantPrincipal;
  }
}
