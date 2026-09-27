import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
  LeaseVehiclesService,
  type LeaseVehicleType
} from "./lease-vehicles.service.js";

type BodyInput = Record<string, unknown>;

function requiredString(input: BodyInput, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(field + " is required.");
  }
  return value.trim();
}

function optionalString(input: BodyInput, field: string): string | undefined {
  const value = input[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
}

@RequireTenantFeature("leases")
@Controller("admin/leases/:leaseId/vehicles")
@UseGuards(TenantPrincipalGuard)
export class LeaseVehiclesController {
  constructor(private readonly vehicles: LeaseVehiclesService) {}

  @Get()
  list(
    @Req() request: TenantRequest,
    @Param("leaseId", new ParseUUIDPipe({ version: "4" })) leaseId: string
  ) {
    return this.vehicles.listVehicles(this.principal(request), leaseId);
  }

  @Post()
  add(
    @Req() request: TenantRequest,
    @Param("leaseId", new ParseUUIDPipe({ version: "4" })) leaseId: string,
    @Body() input: BodyInput
  ) {
    return this.vehicles.addVehicle(this.principal(request), leaseId, {
      licensePlate: requiredString(input, "licensePlate"),
      vehicleType: optionalString(input, "vehicleType") as LeaseVehicleType | undefined,
      brandModel: optionalString(input, "brandModel"),
      ownerName: optionalString(input, "ownerName"),
      registeredAt: optionalString(input, "registeredAt")
    });
  }

  @Patch(":vehicleId")
  update(
    @Req() request: TenantRequest,
    @Param("leaseId", new ParseUUIDPipe({ version: "4" })) leaseId: string,
    @Param("vehicleId", new ParseUUIDPipe({ version: "4" })) vehicleId: string,
    @Body() input: BodyInput
  ) {
    return this.vehicles.updateVehicle(
      this.principal(request),
      leaseId,
      vehicleId,
      {
        licensePlate: optionalString(input, "licensePlate"),
        vehicleType: optionalString(input, "vehicleType") as LeaseVehicleType | undefined,
        brandModel: optionalString(input, "brandModel"),
        ownerName: optionalString(input, "ownerName"),
        isActive:
          typeof input.isActive === "boolean" ? input.isActive : undefined
      }
    );
  }

  @Delete(":vehicleId")
  remove(
    @Req() request: TenantRequest,
    @Param("leaseId", new ParseUUIDPipe({ version: "4" })) leaseId: string,
    @Param("vehicleId", new ParseUUIDPipe({ version: "4" })) vehicleId: string
  ) {
    return this.vehicles.removeVehicle(
      this.principal(request),
      leaseId,
      vehicleId
    );
  }

  private principal(request: TenantRequest): TenantPrincipal {
    if (!request.tenantPrincipal) {
      throw new Error("TenantPrincipalGuard did not attach a principal.");
    }
    return request.tenantPrincipal;
  }
}
