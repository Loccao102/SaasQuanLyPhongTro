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
import { TenantPrincipalGuard } from "../identity/tenant-principal.guard.js";
import type {
  TenantPrincipal,
  TenantRequest
} from "../identity/tenant-principal.js";
import {
  MeteringService,
  type MeterReadingSource,
  type MeterType
} from "./metering.service.js";

type BodyInput = Record<string, unknown>;

function requiredString(input: BodyInput, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(field + " is required.");
  }
  return value.trim();
}

function optionalString(input: BodyInput, field: string): string | null {
  const value = input[field];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new BadRequestException(field + " must be a string.");
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

@Controller("admin/metering")
@UseGuards(TenantPrincipalGuard)
export class MeteringController {
  constructor(private readonly metering: MeteringService) {}

  @Get("rooms/:roomId/meters")
  listRoomMeters(
    @Req() request: TenantRequest,
    @Param("roomId", new ParseUUIDPipe({ version: "4" })) roomId: string
  ) {
    return this.metering.listRoomMeters(this.principal(request), roomId);
  }

  @Post("meters")
  createMeter(@Req() request: TenantRequest, @Body() input: BodyInput) {
    return this.metering.createMeter(this.principal(request), {
      id: requiredUuid(input, "id"),
      roomId: requiredUuid(input, "roomId"),
      meterType: requiredString(input, "meterType") as MeterType,
      label: optionalString(input, "label")
    });
  }

  @Get("meters/:meterId/readings")
  listReadings(
    @Req() request: TenantRequest,
    @Param("meterId", new ParseUUIDPipe({ version: "4" })) meterId: string
  ) {
    return this.metering.listReadings(this.principal(request), meterId);
  }

  @Post("meters/:meterId/readings")
  addReading(
    @Req() request: TenantRequest,
    @Param("meterId", new ParseUUIDPipe({ version: "4" })) meterId: string,
    @Body() input: BodyInput
  ) {
    return this.metering.addReading(this.principal(request), meterId, {
      id: requiredUuid(input, "id"),
      readingDate: requiredString(input, "readingDate"),
      readingValue: decimalInput(input, "readingValue"),
      source: (optionalString(input, "source") ?? "ADMIN") as MeterReadingSource
    });
  }

  private principal(request: TenantRequest): TenantPrincipal {
    if (!request.tenantPrincipal) {
      throw new Error("TenantPrincipalGuard did not attach a principal.");
    }
    return request.tenantPrincipal;
  }
}
