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
import type { TenantRequest } from "../identity/tenant-principal.js";
import { TenantSubscriptionService } from "./application/tenant-subscription.service.js";

type UpgradeBody = {
  targetPlanCode?: string;
  billingInterval?: string;
};

@Controller("admin/subscription")
@UseGuards(TenantPrincipalGuard)
export class TenantSubscriptionController {
  constructor(private readonly service: TenantSubscriptionService) {}

  @Get()
  getOverview(@Req() req: TenantRequest) {
    return this.service.getOverview(req.tenantPrincipal!);
  }

  @Post("upgrade")
  createUpgradeRequest(@Req() req: TenantRequest, @Body() body: UpgradeBody) {
    const targetPlanCode = String(body.targetPlanCode ?? "").trim();
    if (!targetPlanCode) {
      throw new BadRequestException("targetPlanCode is required.");
    }
    const billingInterval = body.billingInterval === "YEARLY" ? "YEARLY" : "MONTHLY";

    return this.service.createUpgradeRequest(req.tenantPrincipal!, {
      targetPlanCode,
      billingInterval
    });
  }

  @Get("invoices")
  listInvoices(@Req() req: TenantRequest) {
    return this.service.listInvoices(req.tenantPrincipal!);
  }

  @Get("invoices/:invoiceId/status")
  checkInvoiceStatus(
    @Req() req: TenantRequest,
    @Param("invoiceId", ParseUUIDPipe) invoiceId: string
  ) {
    return this.service.checkInvoiceStatus(req.tenantPrincipal!, invoiceId);
  }
}
