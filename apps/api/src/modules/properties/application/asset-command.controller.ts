import {
  BadRequestException,
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
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
  AssetCommandService,
  type PropertyType
} from "./asset-command.service.js";

type AssetBody = Record<string, unknown>;

const propertyTypes = new Set<PropertyType>([
  "BOARDING_HOUSE",
  "MINI_APARTMENT",
  "APARTMENT",
  "OTHER"
]);

function requiredString(input: AssetBody, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(field + " is required.");
  }
  return value.trim();
}

function requiredUuid(input: AssetBody, field: string): string {
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

function optionalString(
  input: AssetBody,
  field: string
): string | null | undefined {
  const value = input[field];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new BadRequestException(field + " must be a string or null.");
  }
  return value;
}

function optionalInteger(input: AssetBody, field: string): number | undefined {
  const value = input[field];
  if (value === undefined) return undefined;
  if (!Number.isInteger(value)) {
    throw new BadRequestException(field + " must be an integer.");
  }
  return Number(value);
}

function requiredPropertyType(input: AssetBody): PropertyType {
  const value = requiredString(input, "propertyType") as PropertyType;
  if (!propertyTypes.has(value)) {
    throw new BadRequestException("Invalid propertyType.");
  }
  return value;
}

function optionalPropertyType(input: AssetBody): PropertyType | undefined {
  if (input.propertyType === undefined) return undefined;
  return requiredPropertyType(input);
}

@Controller("admin/assets")
@UseGuards(TenantPrincipalGuard)
export class AssetCommandController {
  constructor(private readonly commands: AssetCommandService) {}

  @Post("properties")
  createProperty(@Req() request: TenantRequest, @Body() input: AssetBody) {
    return this.commands.createProperty(this.principal(request), {
      id: requiredUuid(input, "id"),
      code: requiredString(input, "code"),
      name: requiredString(input, "name"),
      propertyType: requiredPropertyType(input),
      addressText: optionalString(input, "addressText")
    });
  }

  @Patch("properties/:propertyId")
  updateProperty(
    @Req() request: TenantRequest,
    @Param("propertyId", new ParseUUIDPipe({ version: "4" })) propertyId: string,
    @Body() input: AssetBody
  ) {
    return this.commands.updateProperty(this.principal(request), propertyId, {
      code: optionalString(input, "code") ?? undefined,
      name: optionalString(input, "name") ?? undefined,
      propertyType: optionalPropertyType(input),
      addressText: optionalString(input, "addressText")
    });
  }

  @Post("properties/:propertyId/floors")
  createFloor(
    @Req() request: TenantRequest,
    @Param("propertyId", new ParseUUIDPipe({ version: "4" })) propertyId: string,
    @Body() input: AssetBody
  ) {
    return this.commands.createFloor(this.principal(request), propertyId, {
      id: requiredUuid(input, "id"),
      code: requiredString(input, "code"),
      name: requiredString(input, "name"),
      sortOrder: optionalInteger(input, "sortOrder")
    });
  }

  @Patch("floors/:floorId")
  updateFloor(
    @Req() request: TenantRequest,
    @Param("floorId", new ParseUUIDPipe({ version: "4" })) floorId: string,
    @Body() input: AssetBody
  ) {
    return this.commands.updateFloor(this.principal(request), floorId, {
      code: optionalString(input, "code") ?? undefined,
      name: optionalString(input, "name") ?? undefined,
      sortOrder: optionalInteger(input, "sortOrder")
    });
  }

  @Post("properties/:propertyId/rooms")
  createRoom(
    @Req() request: TenantRequest,
    @Param("propertyId", new ParseUUIDPipe({ version: "4" })) propertyId: string,
    @Body() input: AssetBody
  ) {
    return this.commands.createRoom(this.principal(request), propertyId, {
      id: requiredUuid(input, "id"),
      floorId: optionalString(input, "floorId"),
      code: requiredString(input, "code"),
      name: requiredString(input, "name"),
      sortOrder: optionalInteger(input, "sortOrder")
    });
  }

  @Patch("rooms/:roomId")
  updateRoom(
    @Req() request: TenantRequest,
    @Param("roomId", new ParseUUIDPipe({ version: "4" })) roomId: string,
    @Body() input: AssetBody
  ) {
    return this.commands.updateRoom(this.principal(request), roomId, {
      floorId: optionalString(input, "floorId"),
      code: optionalString(input, "code") ?? undefined,
      name: optionalString(input, "name") ?? undefined,
      sortOrder: optionalInteger(input, "sortOrder")
    });
  }

  @Post("rooms/:roomId/deactivate")
  deactivateRoom(
    @Req() request: TenantRequest,
    @Param("roomId", new ParseUUIDPipe({ version: "4" })) roomId: string
  ) {
    return this.commands.deactivateRoom(this.principal(request), roomId);
  }

  @Post("floors/:floorId/deactivate")
  deactivateFloor(
    @Req() request: TenantRequest,
    @Param("floorId", new ParseUUIDPipe({ version: "4" })) floorId: string
  ) {
    return this.commands.deactivateFloor(this.principal(request), floorId);
  }

  @Post("properties/:propertyId/deactivate")
  deactivateProperty(
    @Req() request: TenantRequest,
    @Param("propertyId", new ParseUUIDPipe({ version: "4" })) propertyId: string
  ) {
    return this.commands.deactivateProperty(this.principal(request), propertyId);
  }

  private principal(request: TenantRequest): TenantPrincipal {
    if (!request.tenantPrincipal) {
      throw new Error("TenantPrincipalGuard did not attach a principal.");
    }
    return request.tenantPrincipal;
  }
}
