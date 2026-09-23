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
import { TenantPrincipalGuard } from "../identity/tenant-principal.guard.js";
import type {
  TenantPrincipal,
  TenantRequest
} from "../identity/tenant-principal.js";
import { StaffMeteringService } from "./staff-metering.service.js";

type BodyInput = Record<string, unknown>;

function requiredString(input: BodyInput, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(field + " is required.");
  }
  return value.trim();
}

function requiredUuid(input: BodyInput, field: string): string {
  const value = requiredString(input, field);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  ) {
    throw new BadRequestException(field + " must be a UUID v4.");
  }
  return value;
}

function decimalInput(input: BodyInput, field: string): string | number {
  const value = input[field];
  if (typeof value !== "string" && typeof value !== "number") {
    throw new BadRequestException(field + " must be a number or decimal string.");
  }
  return value;
}

@Controller("staff/metering")
@UseGuards(TenantPrincipalGuard)
export class StaffMeteringController {
  constructor(private readonly staffMetering: StaffMeteringService) {}

  @Get("checklist")
  checklist(
    @Req() request: TenantRequest,
    @Query("readingDate") readingDate: string | undefined
  ) {
    if (!readingDate) {
      throw new BadRequestException("readingDate is required.");
    }
    return this.staffMetering.checklist(this.principal(request), readingDate);
  }

  @Post("meters/:meterId/readings")
  addReading(
    @Req() request: TenantRequest,
    @Param("meterId", new ParseUUIDPipe({ version: "4" })) meterId: string,
    @Body() input: BodyInput
  ) {
    return this.staffMetering.addStaffReading(
      this.principal(request),
      meterId,
      {
        id: requiredUuid(input, "id"),
        readingDate: requiredString(input, "readingDate"),
        readingValue: decimalInput(input, "readingValue")
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
