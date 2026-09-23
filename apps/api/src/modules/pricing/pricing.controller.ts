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
  PricingService,
  type CreatePricingPolicyInput,
  type PricingItemType
} from "./pricing.service.js";

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

function requiredInteger(input: BodyInput, field: string): number {
  const value = input[field];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new BadRequestException(field + " must be an integer.");
  }
  return value;
}

function parseItems(value: unknown): CreatePricingPolicyInput["items"] {
  if (!Array.isArray(value)) {
    throw new BadRequestException("items must be an array.");
  }

  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new BadRequestException("items[" + index + "] must be an object.");
    }
    const item = raw as BodyInput;
    const fixedQuantity = item.fixedQuantity;
    if (
      fixedQuantity !== undefined &&
      typeof fixedQuantity !== "number" &&
      typeof fixedQuantity !== "string"
    ) {
      throw new BadRequestException(
        "items[" + index + "].fixedQuantity must be a number or decimal string."
      );
    }

    return {
      id: requiredUuid(item, "id"),
      itemType: requiredString(item, "itemType") as PricingItemType,
      description: requiredString(item, "description"),
      unitPriceVnd: requiredInteger(item, "unitPriceVnd"),
      fixedQuantity: fixedQuantity as number | string | undefined,
      sortOrder:
        item.sortOrder === undefined ? index * 10 + 20 : requiredInteger(item, "sortOrder")
    };
  });
}

@Controller("admin/pricing")
@UseGuards(TenantPrincipalGuard)
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get("properties/:propertyId/policies")
  list(
    @Req() request: TenantRequest,
    @Param("propertyId", new ParseUUIDPipe({ version: "4" })) propertyId: string
  ) {
    return this.pricing.listForProperty(this.principal(request), propertyId);
  }

  @Post("policies")
  create(@Req() request: TenantRequest, @Body() input: BodyInput) {
    return this.pricing.createPolicy(this.principal(request), {
      id: requiredUuid(input, "id"),
      propertyId: requiredUuid(input, "propertyId"),
      name: requiredString(input, "name"),
      effectiveFrom: requiredString(input, "effectiveFrom"),
      effectiveTo: optionalString(input, "effectiveTo"),
      items: parseItems(input.items)
    });
  }

  private principal(request: TenantRequest): TenantPrincipal {
    if (!request.tenantPrincipal) {
      throw new Error("TenantPrincipalGuard did not attach a principal.");
    }
    return request.tenantPrincipal;
  }
}
