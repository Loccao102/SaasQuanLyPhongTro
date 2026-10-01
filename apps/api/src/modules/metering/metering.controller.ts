import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import type { Response } from "express";
import { TenantPrincipalGuard } from "../identity/tenant-principal.guard.js";
import { RequireTenantFeature } from "../identity/tenant-feature.js";
import type {
  TenantPrincipal,
  TenantRequest
} from "../identity/tenant-principal.js";
import {
  MeteringService,
  type MeterReadingSource,
  type MeterType
} from "./metering.service.js";
import { StaffMeteringService } from "./staff-metering.service.js";

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

function optionalBoolean(input: BodyInput, field: string): boolean | undefined {
  const value = input[field];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new BadRequestException(field + " must be a boolean.");
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

@RequireTenantFeature("metering")
@Controller("admin/metering")
@UseGuards(TenantPrincipalGuard)
export class MeteringController {
  constructor(
    private readonly metering: MeteringService,
    private readonly staffMetering: StaffMeteringService
  ) {}

  @Get("checklist")
  async checklist(
    @Req() request: TenantRequest,
    @Query("readingDate") readingDate: string | undefined
  ) {
    if (!readingDate) {
      throw new BadRequestException("readingDate is required.");
    }
    return this.staffMetering.checklist(
      this.principal(request),
      readingDate
    );
  }

  @Get("progress")
  async progress(
    @Req() request: TenantRequest,
    @Query("readingDate") readingDate: string | undefined
  ) {
    if (!readingDate) {
      throw new BadRequestException("readingDate is required.");
    }
    const checklist = await this.staffMetering.checklist(
      this.principal(request),
      readingDate
    );
    return {
      organization: checklist.organization,
      readingDate: checklist.readingDate,
      summary: checklist.summary,
      properties: checklist.properties.map((property) => ({
        id: property.id,
        code: property.code,
        name: property.name,
        roomCount: property.roomCount,
        completedRoomCount: property.completedRoomCount,
        pendingRoomCount: property.pendingRoomCount,
        missingMeterRoomCount: property.missingMeterRoomCount
      }))
    };
  }

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

  @Patch("meters/:meterId")
  updateMeter(
    @Req() request: TenantRequest,
    @Param("meterId", new ParseUUIDPipe({ version: "4" })) meterId: string,
    @Body() input: BodyInput
  ) {
    return this.metering.updateMeter(this.principal(request), meterId, {
      label: input.label === undefined ? undefined : optionalString(input, "label"),
      isActive: optionalBoolean(input, "isActive")
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
      source: (optionalString(input, "source") ?? "ADMIN") as MeterReadingSource,
      allowCorrection: optionalBoolean(input, "allowCorrection")
    });
  }

  @Post("readings/batch")
  batchAddReadings(
    @Req() request: TenantRequest,
    @Body() input: BodyInput
  ) {
    const readingDate = requiredString(input, "readingDate");
    const rawReadings = input.readings;
    if (!Array.isArray(rawReadings) || rawReadings.length === 0) {
      throw new BadRequestException("readings must be a non-empty array.");
    }
    const readings = rawReadings.map((item, index) => {
      if (typeof item !== "object" || item === null) {
        throw new BadRequestException(`readings[${index}] must be an object.`);
      }
      const r = item as Record<string, unknown>;
      return {
        id: requiredUuid(r, "id"),
        meterId: requiredUuid(r, "meterId"),
        readingValue: decimalInput(r, "readingValue"),
        allowCorrection: optionalBoolean(r, "allowCorrection") ?? true
      };
    });
    return this.metering.batchAddReadings(this.principal(request), {
      readingDate,
      readings
    });
  }

  @Get("properties/:propertyId/excel-template")
  async exportExcelTemplate(
    @Req() request: TenantRequest,
    @Res() res: Response,
    @Param("propertyId", new ParseUUIDPipe({ version: "4" })) propertyId: string,
    @Query("readingDate") readingDate: string | undefined
  ) {
    if (!readingDate) {
      throw new BadRequestException("readingDate is required.");
    }
    const buffer = await this.metering.generateExcelTemplate(
      this.principal(request),
      propertyId,
      readingDate
    );
    const filename = `mau_nhap_dien_nuoc_${readingDate}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );
    res.send(buffer);
  }

  @Post("properties/:propertyId/excel-import")
  async importExcel(
    @Req() request: TenantRequest,
    @Param("propertyId", new ParseUUIDPipe({ version: "4" })) propertyId: string,
    @Body() input: BodyInput
  ) {
    const readingDate = requiredString(input, "readingDate");
    const fileBase64 = requiredString(input, "fileBase64");
    const buffer = Buffer.from(fileBase64, "base64");
    return this.metering.importFromExcel(
      this.principal(request),
      propertyId,
      readingDate,
      buffer
    );
  }

  private principal(request: TenantRequest): TenantPrincipal {
    if (!request.tenantPrincipal) {
      throw new Error("TenantPrincipalGuard did not attach a principal.");
    }
    return request.tenantPrincipal;
  }
}
