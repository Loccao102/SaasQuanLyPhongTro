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
  LeaseDraftManagementService,
  type LeasePartyRole
} from "./lease-draft-management.service.js";

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
  return value;
}

function requiredInteger(input: BodyInput, field: string): number {
  const value = input[field];
  if (!Number.isSafeInteger(value)) {
    throw new BadRequestException(field + " must be an integer.");
  }
  return Number(value);
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

@Controller("admin/leases")
@UseGuards(TenantPrincipalGuard)
export class LeaseDraftManagementController {
  constructor(private readonly drafts: LeaseDraftManagementService) {}

  @Get("residents/search")
  searchResidents(
    @Req() request: TenantRequest,
    @Query("propertyId") propertyId: string | undefined,
    @Query("q") query: string | undefined
  ) {
    if (!propertyId) {
      throw new BadRequestException("propertyId is required.");
    }
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        propertyId
      )
    ) {
      throw new BadRequestException("propertyId must be a UUID v4.");
    }
    return this.drafts.searchResidents(
      this.principal(request),
      propertyId,
      query ?? ""
    );
  }

  @Patch(":leaseId/draft")
  updateDraft(
    @Req() request: TenantRequest,
    @Param("leaseId", new ParseUUIDPipe({ version: "4" })) leaseId: string,
    @Body() input: BodyInput
  ) {
    return this.drafts.updateDraft(this.principal(request), leaseId, {
      expectedVersion: requiredInteger(input, "expectedVersion"),
      leaseCode: requiredString(input, "leaseCode"),
      startDate: requiredString(input, "startDate"),
      plannedEndDate: optionalString(input, "plannedEndDate"),
      baseRentVnd: requiredInteger(input, "baseRentVnd"),
      depositRequiredVnd: requiredInteger(input, "depositRequiredVnd"),
      billingDay: requiredInteger(input, "billingDay")
    });
  }

  @Post(":leaseId/draft/parties")
  addParty(
    @Req() request: TenantRequest,
    @Param("leaseId", new ParseUUIDPipe({ version: "4" })) leaseId: string,
    @Body() input: BodyInput
  ) {
    const partyRole = requiredString(input, "partyRole");
    if (partyRole !== "CO_TENANT" && partyRole !== "OCCUPANT") {
      throw new BadRequestException(
        "partyRole must be CO_TENANT or OCCUPANT."
      );
    }

    let resident: {
      fullName: string;
      phone?: string | null;
      email?: string | null;
    } | null = null;
    if (input.resident !== undefined && input.resident !== null) {
      if (
        typeof input.resident !== "object" ||
        Array.isArray(input.resident)
      ) {
        throw new BadRequestException("resident must be an object.");
      }
      const raw = input.resident as BodyInput;
      resident = {
        fullName: requiredString(raw, "fullName"),
        phone: optionalString(raw, "phone"),
        email: optionalString(raw, "email")
      };
    }

    return this.drafts.addParty(this.principal(request), leaseId, {
      residentId: requiredUuid(input, "residentId"),
      partyRole: partyRole as LeasePartyRole,
      resident
    });
  }

  @Post(":leaseId/draft/parties/:residentId/remove")
  removeParty(
    @Req() request: TenantRequest,
    @Param("leaseId", new ParseUUIDPipe({ version: "4" })) leaseId: string,
    @Param("residentId", new ParseUUIDPipe({ version: "4" })) residentId: string
  ) {
    return this.drafts.removeParty(
      this.principal(request),
      leaseId,
      residentId
    );
  }

  private principal(request: TenantRequest): TenantPrincipal {
    if (!request.tenantPrincipal) {
      throw new Error("TenantPrincipalGuard did not attach a principal.");
    }
    return request.tenantPrincipal;
  }
}
