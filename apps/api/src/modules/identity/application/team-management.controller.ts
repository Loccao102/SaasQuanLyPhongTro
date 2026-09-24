import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import { TenantPrincipalGuard } from "../tenant-principal.guard.js";
import type { TenantRequest } from "../tenant-principal.js";
import { roles, type Role } from "../domain/access-control.js";
import {
  TeamManagementService,
  type TeamScopeInput
} from "./team-management.service.js";

type BodyInput = Record<string, unknown>;

@Controller("admin/team")
@UseGuards(TenantPrincipalGuard)
export class TeamManagementController {
  constructor(private readonly team: TeamManagementService) {}

  @Get()
  overview(@Req() request: TenantRequest) {
    return this.team.overview(this.principal(request));
  }

  @Post("members")
  invite(@Req() request: TenantRequest, @Body() input: BodyInput) {
    return this.team.invite(this.principal(request), {
      email: this.string(input, "email"),
      displayName: this.string(input, "displayName"),
      role: this.role(input.role),
      scopes: this.scopes(input.scopes)
    });
  }

  @Patch("members/:membershipId")
  updateMember(
    @Req() request: TenantRequest,
    @Param("membershipId", new ParseUUIDPipe({ version: "4" })) membershipId: string,
    @Body() input: BodyInput
  ) {
    return this.team.updateMember(this.principal(request), membershipId, {
      role: this.role(input.role),
      scopes: this.scopes(input.scopes)
    });
  }

  @Post("members/:membershipId/activate")
  activate(
    @Req() request: TenantRequest,
    @Param("membershipId", new ParseUUIDPipe({ version: "4" })) membershipId: string
  ) {
    return this.team.activate(this.principal(request), membershipId);
  }

  @Post("members/:membershipId/suspend")
  suspend(
    @Req() request: TenantRequest,
    @Param("membershipId", new ParseUUIDPipe({ version: "4" })) membershipId: string
  ) {
    return this.team.suspend(this.principal(request), membershipId);
  }

  @Post("groups")
  createGroup(@Req() request: TenantRequest, @Body() input: BodyInput) {
    return this.team.createGroup(this.principal(request), {
      code: this.string(input, "code"),
      name: this.string(input, "name"),
      propertyIds: this.uuidArray(input.propertyIds, "propertyIds")
    });
  }

  @Patch("groups/:groupId")
  updateGroup(
    @Req() request: TenantRequest,
    @Param("groupId", new ParseUUIDPipe({ version: "4" })) groupId: string,
    @Body() input: BodyInput
  ) {
    return this.team.updateGroup(this.principal(request), groupId, {
      code: this.string(input, "code"),
      name: this.string(input, "name"),
      propertyIds: this.uuidArray(input.propertyIds, "propertyIds")
    });
  }

  @Post("groups/:groupId/deactivate")
  deactivateGroup(
    @Req() request: TenantRequest,
    @Param("groupId", new ParseUUIDPipe({ version: "4" })) groupId: string
  ) {
    return this.team.deactivateGroup(this.principal(request), groupId);
  }

  private principal(request: TenantRequest) {
    if (!request.tenantPrincipal) {
      throw new Error("TenantPrincipalGuard did not attach a principal.");
    }
    return request.tenantPrincipal;
  }

  private string(input: BodyInput, field: string) {
    const value = input[field];
    if (typeof value !== "string" || !value.trim()) {
      throw new BadRequestException(field + " is required.");
    }
    return value.trim();
  }

  private role(value: unknown): Role {
    if (typeof value !== "string" || !roles.includes(value as Role)) {
      throw new BadRequestException("Invalid role.");
    }
    return value as Role;
  }

  private scopes(value: unknown): TeamScopeInput[] {
    if (!Array.isArray(value) || value.length === 0) {
      throw new BadRequestException("scopes must be a non-empty array.");
    }
    return value.map((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        throw new BadRequestException("Invalid scope.");
      }
      const scope = item as BodyInput;
      if (scope.type === "ORGANIZATION") {
        return { type: "ORGANIZATION" } as const;
      }
      if (scope.type === "OPERATIONAL_GROUP") {
        return {
          type: "OPERATIONAL_GROUP" as const,
          operationalGroupId: this.uuid(scope.operationalGroupId, "operationalGroupId")
        };
      }
      if (scope.type === "PROPERTY") {
        return {
          type: "PROPERTY" as const,
          propertyId: this.uuid(scope.propertyId, "propertyId")
        };
      }
      throw new BadRequestException("Invalid scope type.");
    });
  }

  private uuidArray(value: unknown, field: string): string[] {
    if (!Array.isArray(value)) {
      throw new BadRequestException(field + " must be an array.");
    }
    return value.map((item) => this.uuid(item, field));
  }

  private uuid(value: unknown, field: string): string {
    if (
      typeof value !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ) {
      throw new BadRequestException(field + " must contain UUID values.");
    }
    return value;
  }
}
