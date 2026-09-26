import {
  Controller,
  Get,
  Query,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import type { Response } from "express";
import { TenantPrincipalGuard } from "../identity/tenant-principal.guard.js";
import type {
  TenantPrincipal,
  TenantRequest
} from "../identity/tenant-principal.js";
import { ReportingService } from "./reporting.service.js";

@Controller("admin/reports")
@UseGuards(TenantPrincipalGuard)
export class ReportingController {
  constructor(private readonly reporting: ReportingService) {}

  // ── CSV export endpoints ─────────────────────────────────

  @Get("meter-readings/export")
  async exportMeterReadings(
    @Req() req: TenantRequest,
    @Res() res: Response,
    @Query("propertyId") propertyId?: string,
    @Query("fromDate") fromDate?: string,
    @Query("toDate") toDate?: string
  ) {
    const { csv, filename } = await this.reporting.exportMeterReadings(
      this.principal(req),
      {
        propertyId: propertyId?.trim() || null,
        fromDate: fromDate?.trim() || null,
        toDate: toDate?.trim() || null
      }
    );
    this.sendCsv(res, csv, filename);
  }

  @Get("revenue-debt/export")
  async exportRevenueDebt(
    @Req() req: TenantRequest,
    @Res() res: Response,
    @Query("propertyId") propertyId?: string,
    @Query("fromDate") fromDate?: string,
    @Query("toDate") toDate?: string
  ) {
    const { csv, filename } = await this.reporting.exportRevenueDebt(
      this.principal(req),
      {
        propertyId: propertyId?.trim() || null,
        fromDate: fromDate?.trim() || null,
        toDate: toDate?.trim() || null
      }
    );
    this.sendCsv(res, csv, filename);
  }

  @Get("cashflow/export")
  async exportCashflow(
    @Req() req: TenantRequest,
    @Res() res: Response,
    @Query("propertyId") propertyId?: string,
    @Query("fromDate") fromDate?: string,
    @Query("toDate") toDate?: string
  ) {
    const { csv, filename } = await this.reporting.exportCashflow(
      this.principal(req),
      {
        propertyId: propertyId?.trim() || null,
        fromDate: fromDate?.trim() || null,
        toDate: toDate?.trim() || null
      }
    );
    this.sendCsv(res, csv, filename);
  }

  @Get("property-summary/export")
  async exportPropertySummary(
    @Req() req: TenantRequest,
    @Res() res: Response,
    @Query("fromDate") fromDate?: string,
    @Query("toDate") toDate?: string
  ) {
    const { csv, filename } = await this.reporting.exportPropertySummary(
      this.principal(req),
      {
        fromDate: fromDate?.trim() || null,
        toDate: toDate?.trim() || null
      }
    );
    this.sendCsv(res, csv, filename);
  }

  // ── JSON endpoints (for UI dashboard) ────────────────────

  @Get("property-summary")
  getPropertySummary(
    @Req() req: TenantRequest,
    @Query("fromDate") fromDate?: string,
    @Query("toDate") toDate?: string
  ) {
    return this.reporting.getPropertySummary(this.principal(req), {
      fromDate: fromDate?.trim() || null,
      toDate: toDate?.trim() || null
    });
  }

  // ── Helpers ──────────────────────────────────────────────

  private sendCsv(res: Response, csv: string, filename: string) {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );
    res.send(csv);
  }

  private principal(request: TenantRequest): TenantPrincipal {
    if (!request.tenantPrincipal) {
      throw new Error("TenantPrincipalGuard did not attach a principal.");
    }
    return request.tenantPrincipal;
  }
}
