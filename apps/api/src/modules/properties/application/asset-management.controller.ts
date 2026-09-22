import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import {
  CommercialResourceLimitExceededError,
  CommercialSubscriptionNotFoundError,
  CommercialWriteRestrictedError,
  OrganizationCommercialPolicyNotFoundError
} from "../../commercial/application/commercial-policy.service.js";
import { TenantPrincipalGuard } from "../../identity/tenant-principal.guard.js";
import type {
  TenantPrincipal,
  TenantRequest
} from "../../identity/tenant-principal.js";
import {
  FloorApplicationService,
  FloorAuthorizationError,
  FloorCodeConflictError,
  FloorIdentityConflictError,
  FloorInputError,
  FloorPropertyNotFoundError
} from "./floor-application.service.js";
import {
  PropertyApplicationService,
  PropertyCodeConflictError,
  PropertyCreateAuthorizationError,
  PropertyIdentityConflictError,
  PropertyInputError
} from "./property-application.service.js";
import {
  FloorNotFoundError,
  PropertyAuthorizationError,
  PropertyNotFoundError,
  RoomApplicationService,
  RoomCodeConflictError,
  RoomIdentityConflictError
} from "./room-application.service.js";

const propertyTypes = [
  "BOARDING_HOUSE",
  "MINI_APARTMENT",
  "APARTMENT",
  "OTHER"
] as const;

type CreatePropertyBody = {
  propertyId?: unknown;
  code?: unknown;
  name?: unknown;
  propertyType?: unknown;
  addressText?: unknown;
};

type CreateFloorBody = {
  floorId?: unknown;
  code?: unknown;
  name?: unknown;
  sortOrder?: unknown;
};

type CreateRoomBody = {
  roomId?: unknown;
  floorId?: unknown;
  code?: unknown;
  name?: unknown;
  sortOrder?: unknown;
};

@Controller("admin/assets")
@UseGuards(TenantPrincipalGuard)
export class AssetManagementController {
  constructor(
    private readonly properties: PropertyApplicationService,
    private readonly floors: FloorApplicationService,
    private readonly rooms: RoomApplicationService
  ) {}

  @Post("properties")
  async createProperty(
    @Req() request: TenantRequest,
    @Body() body: CreatePropertyBody
  ) {
    const principal = this.principal(request);

    try {
      return await this.properties.create({
        actor: this.actor(principal),
        organizationId: principal.organizationId,
        propertyId: this.uuid(body.propertyId, "propertyId"),
        code: this.text(body.code, "code", 64),
        name: this.text(body.name, "name", 200),
        propertyType: this.propertyType(body.propertyType),
        addressText: this.optionalText(body.addressText, "addressText", 500)
      });
    } catch (error) {
      this.rethrowMutationError(error);
    }
  }

  @Post("properties/:propertyId/floors")
  async createFloor(
    @Req() request: TenantRequest,
    @Param("propertyId", new ParseUUIDPipe({ version: "4" })) propertyId: string,
    @Body() body: CreateFloorBody
  ) {
    const principal = this.principal(request);

    try {
      return await this.floors.create({
        actor: this.actor(principal),
        organizationId: principal.organizationId,
        propertyId,
        floorId: this.uuid(body.floorId, "floorId"),
        code: this.text(body.code, "code", 64),
        name: this.text(body.name, "name", 200),
        sortOrder: this.integer(body.sortOrder, "sortOrder")
      });
    } catch (error) {
      this.rethrowMutationError(error);
    }
  }

  @Post("properties/:propertyId/rooms")
  async createRoom(
    @Req() request: TenantRequest,
    @Param("propertyId", new ParseUUIDPipe({ version: "4" })) propertyId: string,
    @Body() body: CreateRoomBody
  ) {
    const principal = this.principal(request);

    try {
      return await this.rooms.create({
        actor: this.actor(principal),
        organizationId: principal.organizationId,
        propertyId,
        roomId: this.uuid(body.roomId, "roomId"),
        floorId: this.optionalUuid(body.floorId, "floorId"),
        code: this.text(body.code, "code", 64),
        name: this.text(body.name, "name", 200),
        sortOrder: this.integer(body.sortOrder, "sortOrder")
      });
    } catch (error) {
      this.rethrowMutationError(error);
    }
  }

  private actor(principal: TenantPrincipal) {
    return {
      userId: principal.userId,
      membership: principal.membership
    };
  }

  private principal(request: TenantRequest): TenantPrincipal {
    if (!request.tenantPrincipal) {
      throw new Error("TenantPrincipalGuard did not attach a principal.");
    }
    return request.tenantPrincipal;
  }

  private text(value: unknown, field: string, max: number): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new BadRequestException(field + " is required.");
    }
    const normalized = value.trim();
    if (normalized.length > max) {
      throw new BadRequestException(field + " is too long.");
    }
    return normalized;
  }

  private optionalText(
    value: unknown,
    field: string,
    max: number
  ): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") {
      throw new BadRequestException(field + " must be a string.");
    }
    const normalized = value.trim();
    if (!normalized) return null;
    if (normalized.length > max) {
      throw new BadRequestException(field + " is too long.");
    }
    return normalized;
  }

  private integer(value: unknown, field: string): number {
    if (value === undefined || value === null || value === "") return 0;
    const normalized =
      typeof value === "number" ? value : Number(String(value).trim());
    if (!Number.isInteger(normalized) || Math.abs(normalized) > 100000) {
      throw new BadRequestException(field + " must be a bounded integer.");
    }
    return normalized;
  }

  private propertyType(value: unknown): (typeof propertyTypes)[number] {
    if (
      typeof value !== "string" ||
      !propertyTypes.includes(value as (typeof propertyTypes)[number])
    ) {
      throw new BadRequestException("propertyType is invalid.");
    }
    return value as (typeof propertyTypes)[number];
  }

  private uuid(value: unknown, field: string): string {
    if (
      typeof value !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value
      )
    ) {
      throw new BadRequestException(field + " must be a UUID v4.");
    }
    return value;
  }

  private optionalUuid(value: unknown, field: string): string | null {
    if (value === undefined || value === null || value === "") return null;
    return this.uuid(value, field);
  }

  private rethrowMutationError(error: unknown): never {
    if (
      error instanceof PropertyCreateAuthorizationError ||
      error instanceof FloorAuthorizationError ||
      error instanceof PropertyAuthorizationError
    ) {
      throw new ForbiddenException(error.message);
    }

    if (
      error instanceof FloorPropertyNotFoundError ||
      error instanceof PropertyNotFoundError ||
      error instanceof FloorNotFoundError ||
      error instanceof OrganizationCommercialPolicyNotFoundError
    ) {
      throw new NotFoundException(error.message);
    }

    if (
      error instanceof PropertyInputError ||
      error instanceof FloorInputError
    ) {
      throw new BadRequestException(error.message);
    }

    if (
      error instanceof PropertyIdentityConflictError ||
      error instanceof PropertyCodeConflictError ||
      error instanceof FloorIdentityConflictError ||
      error instanceof FloorCodeConflictError ||
      error instanceof RoomIdentityConflictError ||
      error instanceof RoomCodeConflictError ||
      error instanceof CommercialResourceLimitExceededError ||
      error instanceof CommercialSubscriptionNotFoundError ||
      error instanceof CommercialWriteRestrictedError
    ) {
      throw new ConflictException(error.message);
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "23505"
    ) {
      throw new ConflictException(
        "Resource identifier or code already exists."
      );
    }

    throw error;
  }
}
