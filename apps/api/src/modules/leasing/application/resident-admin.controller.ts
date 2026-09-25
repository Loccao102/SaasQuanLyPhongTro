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
  UseGuards
} from "@nestjs/common";
import { TenantPrincipalGuard } from "../../identity/tenant-principal.guard.js";
import type {
  TenantPrincipal,
  TenantRequest
} from "../../identity/tenant-principal.js";
import {
  ResidentAdminService,
  type CreateResidentInput,
  type UpdateResidentInput
} from "./resident-admin.service.js";

type BodyInput = Record<string, unknown>;

function optionalString(
  input: BodyInput,
  field: string
): string | null | undefined {
  const value = input[field];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new BadRequestException(`${field} must be a string or null.`);
  }
  return value.trim() || null;
}

function requiredString(input: BodyInput, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${field} is required.`);
  }
  return value.trim();
}

@Controller("admin/residents")
@UseGuards(TenantPrincipalGuard)
export class ResidentAdminController {
  constructor(private readonly service: ResidentAdminService) {}

  @Get("")
  list(
    @Req() req: TenantRequest,
    @Query("q") q: string | undefined,
    @Query("isActive") isActive: string | undefined,
    @Query("propertyId") propertyId: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined
  ) {
    const parsedActive =
      isActive === "true" ? true : isActive === "false" ? false : undefined;

    return this.service.list(this.principal(req), {
      query: q,
      isActive: parsedActive,
      propertyId,
      cursor,
      limit: limit ? Math.min(parseInt(limit, 10) || 50, 100) : 50
    });
  }

  @Get(":residentId")
  detail(
    @Req() req: TenantRequest,
    @Param("residentId", ParseUUIDPipe) residentId: string
  ) {
    return this.service.detail(this.principal(req), residentId);
  }

  @Post("")
  create(@Req() req: TenantRequest, @Body() body: BodyInput) {
    const input: CreateResidentInput = {
      fullName: requiredString(body, "fullName"),
      phone: optionalString(body, "phone"),
      email: optionalString(body, "email"),
      identityDocumentType: optionalString(body, "identityDocumentType"),
      identityDocumentNumber: optionalString(body, "identityDocumentNumber"),
      dateOfBirth: optionalString(body, "dateOfBirth"),
      notes: optionalString(body, "notes")
    };
    return this.service.create(this.principal(req), input);
  }

  @Patch(":residentId")
  update(
    @Req() req: TenantRequest,
    @Param("residentId", ParseUUIDPipe) residentId: string,
    @Body() body: BodyInput
  ) {
    const input: UpdateResidentInput = {};
    if ("fullName" in body) {
      input.fullName = requiredString(body, "fullName");
    }
    if ("phone" in body) input.phone = optionalString(body, "phone");
    if ("email" in body) input.email = optionalString(body, "email");
    if ("identityDocumentType" in body) {
      input.identityDocumentType = optionalString(body, "identityDocumentType");
    }
    if ("identityDocumentNumber" in body) {
      input.identityDocumentNumber = optionalString(
        body,
        "identityDocumentNumber"
      );
    }
    if ("dateOfBirth" in body) {
      input.dateOfBirth = optionalString(body, "dateOfBirth");
    }
    if ("notes" in body) input.notes = optionalString(body, "notes");
    return this.service.update(this.principal(req), residentId, input);
  }

  @Post(":residentId/deactivate")
  deactivate(
    @Req() req: TenantRequest,
    @Param("residentId", ParseUUIDPipe) residentId: string
  ) {
    return this.service.deactivate(this.principal(req), residentId);
  }

  private principal(request: TenantRequest): TenantPrincipal {
    if (!request.tenantPrincipal) {
      throw new Error("TenantPrincipalGuard did not attach a principal.");
    }
    return request.tenantPrincipal;
  }
}
