import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
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
  IdempotencyConflictError,
  InvalidIdempotencyKeyError
} from "./idempotent-command.js";
import {
  LeaseAuthorizationError,
  LeaseLifecycleApplicationService,
  LeaseNotFoundError,
  LeaseRoomOccupancyConflictError,
  LeaseTerminationRecordNotFoundError
} from "./lease-lifecycle-application.service.js";
import {
  InvalidLeaseDateError,
  InvalidLeaseTransitionError,
  LeaseTerminationNotReadyError
} from "../domain/lease-lifecycle.js";
import { LeaseAdminService } from "./lease-admin.service.js";

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
  if (!Number.isSafeInteger(value)) {
    throw new BadRequestException(field + " must be an integer.");
  }
  return Number(value);
}

@Controller("admin/leases")
@UseGuards(TenantPrincipalGuard)
export class LeaseAdminController {
  constructor(
    private readonly admin: LeaseAdminService,
    private readonly lifecycle: LeaseLifecycleApplicationService
  ) {}

  @Get()
  list(@Req() request: TenantRequest) {
    return this.admin.list(this.principal(request));
  }

  @Get(":leaseId")
  detail(
    @Req() request: TenantRequest,
    @Param("leaseId", new ParseUUIDPipe({ version: "4" })) leaseId: string
  ) {
    return this.admin.detail(this.principal(request), leaseId);
  }

  @Post()
  createDraft(@Req() request: TenantRequest, @Body() input: BodyInput) {
    let primaryResident:
      | {
          fullName: string;
          phone?: string | null;
          email?: string | null;
        }
      | null = null;

    if (input.primaryResident !== undefined && input.primaryResident !== null) {
      if (
        typeof input.primaryResident !== "object" ||
        Array.isArray(input.primaryResident)
      ) {
        throw new BadRequestException("primaryResident must be an object.");
      }
      const raw = input.primaryResident as BodyInput;
      primaryResident = {
        fullName: requiredString(raw, "fullName"),
        phone: optionalString(raw, "phone"),
        email: optionalString(raw, "email")
      };
    }

    return this.admin.createDraft(this.principal(request), {
      leaseId: requiredUuid(input, "leaseId"),
      residentId: requiredUuid(input, "residentId"),
      idempotencyKey: requiredString(input, "idempotencyKey"),
      roomId: requiredUuid(input, "roomId"),
      leaseCode: requiredString(input, "leaseCode"),
      startDate: requiredString(input, "startDate"),
      plannedEndDate: optionalString(input, "plannedEndDate"),
      baseRentVnd: requiredInteger(input, "baseRentVnd"),
      depositRequiredVnd: requiredInteger(input, "depositRequiredVnd"),
      billingDay: requiredInteger(input, "billingDay"),
      primaryResident
    });
  }

  @Post(":leaseId/activate")
  activate(
    @Req() request: TenantRequest,
    @Param("leaseId", new ParseUUIDPipe({ version: "4" })) leaseId: string,
    @Body() input: BodyInput
  ) {
    return this.transition(() =>
      this.lifecycle.activate({
        actor: this.actor(request),
        organizationId: this.principal(request).organizationId,
        leaseId,
        idempotencyKey: requiredString(input, "idempotencyKey")
      })
    );
  }

  @Post(":leaseId/cancel-draft")
  cancelDraft(
    @Req() request: TenantRequest,
    @Param("leaseId", new ParseUUIDPipe({ version: "4" })) leaseId: string,
    @Body() input: BodyInput
  ) {
    return this.transition(() =>
      this.lifecycle.cancelDraft({
        actor: this.actor(request),
        organizationId: this.principal(request).organizationId,
        leaseId,
        idempotencyKey: requiredString(input, "idempotencyKey")
      })
    );
  }

  @Post(":leaseId/renew")
  renew(
    @Req() request: TenantRequest,
    @Param("leaseId", new ParseUUIDPipe({ version: "4" })) leaseId: string,
    @Body() input: BodyInput
  ) {
    const newBaseRentVnd =
      input.newBaseRentVnd !== undefined && input.newBaseRentVnd !== null
        ? requiredInteger(input, "newBaseRentVnd")
        : undefined;
    const expectedVersion =
      input.expectedVersion !== undefined && input.expectedVersion !== null
        ? requiredInteger(input, "expectedVersion")
        : undefined;

    return this.transition(() =>
      this.lifecycle.renew({
        actor: this.actor(request),
        organizationId: this.principal(request).organizationId,
        leaseId,
        idempotencyKey: requiredString(input, "idempotencyKey"),
        newPlannedEndDate: requiredString(input, "newPlannedEndDate"),
        expectedVersion,
        newBaseRentVnd,
        note: optionalString(input, "note")
      })
    );
  }

  @Post(":leaseId/termination")
  scheduleTermination(
    @Req() request: TenantRequest,
    @Param("leaseId", new ParseUUIDPipe({ version: "4" })) leaseId: string,
    @Body() input: BodyInput
  ) {
    return this.transition(() =>
      this.lifecycle.scheduleTermination({
        actor: this.actor(request),
        organizationId: this.principal(request).organizationId,
        leaseId,
        idempotencyKey: requiredString(input, "idempotencyKey"),
        effectiveDate: requiredString(input, "effectiveDate"),
        reason: requiredString(input, "reason")
      })
    );
  }

  @Post(":leaseId/termination/cancel")
  cancelTermination(
    @Req() request: TenantRequest,
    @Param("leaseId", new ParseUUIDPipe({ version: "4" })) leaseId: string,
    @Body() input: BodyInput
  ) {
    return this.transition(() =>
      this.lifecycle.cancelTermination({
        actor: this.actor(request),
        organizationId: this.principal(request).organizationId,
        leaseId,
        idempotencyKey: requiredString(input, "idempotencyKey")
      })
    );
  }

  @Post(":leaseId/termination/finalize")
  finalizeTermination(
    @Req() request: TenantRequest,
    @Param("leaseId", new ParseUUIDPipe({ version: "4" })) leaseId: string,
    @Body() input: BodyInput
  ) {
    return this.transition(() =>
      this.lifecycle.finalizeTermination({
        actor: this.actor(request),
        organizationId: this.principal(request).organizationId,
        leaseId,
        idempotencyKey: requiredString(input, "idempotencyKey")
      })
    );
  }

  @Post(":leaseId/amendments")
  createAmendment(
    @Req() request: TenantRequest,
    @Param("leaseId", new ParseUUIDPipe({ version: "4" })) leaseId: string,
    @Body() input: BodyInput
  ) {
    const amendmentNumber = requiredString(input, "amendmentNumber");
    const amendmentType = requiredString(input, "amendmentType");
    const title = requiredString(input, "title");
    const effectiveDate = requiredString(input, "effectiveDate");
    const description = optionalString(input, "description");
    const newBaseRentVnd =
      input.newBaseRentVnd !== undefined && input.newBaseRentVnd !== null
        ? Number(input.newBaseRentVnd)
        : null;
    const newPlannedEndDate = optionalString(input, "newPlannedEndDate");
    const applyImmediately =
      input.applyImmediately !== undefined ? Boolean(input.applyImmediately) : true;

    return this.admin.createAmendment(this.principal(request), leaseId, {
      amendmentNumber,
      amendmentType: amendmentType as any,
      title,
      effectiveDate,
      description,
      newBaseRentVnd,
      newPlannedEndDate,
      applyImmediately
    });
  }

  @Post(":leaseId/attachments")
  addAttachment(
    @Req() request: TenantRequest,
    @Param("leaseId", new ParseUUIDPipe({ version: "4" })) leaseId: string,
    @Body() input: BodyInput
  ) {
    const attachmentType = requiredString(input, "attachmentType");
    const fileName = requiredString(input, "fileName");
    const fileUrl = requiredString(input, "fileUrl");
    const fileSizeBytes =
      input.fileSizeBytes !== undefined ? Number(input.fileSizeBytes) : 0;
    const mimeType = optionalString(input, "mimeType") ?? undefined;
    const description = optionalString(input, "description");

    return this.admin.addAttachment(this.principal(request), leaseId, {
      attachmentType: attachmentType as any,
      fileName,
      fileUrl,
      fileSizeBytes,
      mimeType,
      description
    });
  }

  @Delete(":leaseId/attachments/:attachmentId")
  deleteAttachment(
    @Req() request: TenantRequest,
    @Param("leaseId", new ParseUUIDPipe({ version: "4" })) leaseId: string,
    @Param("attachmentId", new ParseUUIDPipe({ version: "4" })) attachmentId: string
  ) {
    return this.admin.deleteAttachment(
      this.principal(request),
      leaseId,
      attachmentId
    );
  }

  private principal(request: TenantRequest): TenantPrincipal {
    if (!request.tenantPrincipal) {
      throw new Error("TenantPrincipalGuard did not attach a principal.");
    }
    return request.tenantPrincipal;
  }

  private actor(request: TenantRequest) {
    const principal = this.principal(request);
    return {
      userId: principal.userId,
      membership: principal.membership
    };
  }

  private async transition<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof LeaseAuthorizationError) {
        throw new ForbiddenException(error.message);
      }
      if (
        error instanceof LeaseNotFoundError ||
        error instanceof LeaseTerminationRecordNotFoundError
      ) {
        throw new NotFoundException(error.message);
      }
      if (
        error instanceof InvalidLeaseTransitionError ||
        error instanceof InvalidLeaseDateError ||
        error instanceof LeaseTerminationNotReadyError ||
        error instanceof LeaseRoomOccupancyConflictError ||
        error instanceof IdempotencyConflictError
      ) {
        throw new ConflictException(error.message);
      }
      if (error instanceof InvalidIdempotencyKeyError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
