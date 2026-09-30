import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import { TenantPrincipalGuard } from "../../identity/tenant-principal.guard.js";
import { RequireTenantFeature } from "../../identity/tenant-feature.js";
import type {
  TenantPrincipal,
  TenantRequest
} from "../../identity/tenant-principal.js";
import {
  RoomReservationService,
  type CreateReservationInput
} from "./room-reservation.service.js";

type BodyInput = Record<string, unknown>;

function requiredString(input: BodyInput, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(field + " is required.");
  }
  return value.trim();
}

function optionalString(
  input: BodyInput,
  field: string
): string | null | undefined {
  const value = input[field];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new BadRequestException(field + " must be a string or null.");
  }
  return value.trim();
}

function requiredNumber(input: BodyInput, field: string): number {
  const value = input[field];
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) {
    throw new BadRequestException(field + " must be a valid number.");
  }
  return num;
}

@RequireTenantFeature("leases")
@Controller("admin/reservations")
@UseGuards(TenantPrincipalGuard)
export class RoomReservationController {
  constructor(private readonly reservations: RoomReservationService) {}

  private principal(request: TenantRequest): TenantPrincipal {
    if (!request.tenantPrincipal) {
      throw new Error("TenantPrincipalGuard did not attach a principal.");
    }
    return request.tenantPrincipal;
  }

  @Get()
  list(
    @Req() request: TenantRequest,
    @Query("propertyId") propertyId?: string,
    @Query("roomId") roomId?: string,
    @Query("status") status?: string
  ) {
    return this.reservations.list(this.principal(request), {
      propertyId: propertyId ? propertyId.trim() : undefined,
      roomId: roomId ? roomId.trim() : undefined,
      status: status ? status.trim() : undefined
    });
  }

  @Post()
  create(@Req() request: TenantRequest, @Body() body: BodyInput) {
    const input: CreateReservationInput = {
      propertyId: requiredString(body, "propertyId"),
      roomId: requiredString(body, "roomId"),
      prospectiveTenantName: requiredString(body, "prospectiveTenantName"),
      prospectiveTenantPhone: requiredString(body, "prospectiveTenantPhone"),
      prospectiveTenantIdNumber: optionalString(body, "prospectiveTenantIdNumber"),
      depositAmountVnd: requiredNumber(body, "depositAmountVnd"),
      reservedFrom: optionalString(body, "reservedFrom") ?? undefined,
      reservedUntil: requiredString(body, "reservedUntil"),
      expectedMoveInDate: optionalString(body, "expectedMoveInDate"),
      expectedMonthlyRentVnd:
        body.expectedMonthlyRentVnd !== undefined && body.expectedMonthlyRentVnd !== null
          ? requiredNumber(body, "expectedMonthlyRentVnd")
          : null,
      notes: optionalString(body, "notes")
    };

    return this.reservations.create(this.principal(request), input);
  }

  @Post(":id/cancel")
  cancel(
    @Req() request: TenantRequest,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() body: BodyInput
  ) {
    const action = requiredString(body, "action") as "REFUND" | "FORFEIT";
    if (action !== "REFUND" && action !== "FORFEIT") {
      throw new BadRequestException("action must be REFUND or FORFEIT.");
    }
    const reason = optionalString(body, "reason") ?? undefined;

    return this.reservations.cancel(this.principal(request), id, { action, reason });
  }

  @Post(":id/convert-to-lease")
  convertToLease(
    @Req() request: TenantRequest,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string
  ) {
    return this.reservations.convertToLease(this.principal(request), id);
  }
}
