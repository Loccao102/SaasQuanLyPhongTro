import {
  Controller,
  Get,
  Param,
  Req,
  UseGuards
} from "@nestjs/common";
import { CmsBillingDetailService } from "./cms-billing-detail.service.js";
import { CmsPlatformGuard } from "./cms-platform.guard.js";
import type { CmsRequest, PlatformPrincipal } from "./cms.types.js";

@Controller("cms/billing")
@UseGuards(CmsPlatformGuard)
export class CmsBillingDetailController {
  constructor(private readonly billingDetail: CmsBillingDetailService) {}

  @Get("invoices/:invoiceId")
  getInvoiceDetail(
    @Req() request: CmsRequest,
    @Param("invoiceId") invoiceId: string
  ) {
    return this.billingDetail.getInvoiceDetail(
      this.principal(request),
      invoiceId
    );
  }

  private principal(request: CmsRequest): PlatformPrincipal {
    if (!request.platformPrincipal) {
      throw new Error("CmsPlatformGuard did not attach a principal.");
    }
    return request.platformPrincipal;
  }
}
