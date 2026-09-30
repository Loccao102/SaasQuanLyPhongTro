import {
  Controller,
  Get,
  Param,
  Query,
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

  @Get("invoices")
  listInvoices(
    @Req() request: CmsRequest,
    @Query("status") status?: string,
    @Query("plan") plan?: string,
    @Query("q") query?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string
  ) {
    return this.billingDetail.listInvoices(this.principal(request), {
      status,
      plan,
      q: query,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined
    });
  }

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
