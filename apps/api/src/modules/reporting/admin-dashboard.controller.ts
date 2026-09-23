import {
  Controller,
  Get,
  Req,
  UseGuards
} from "@nestjs/common";
import { AdminTenantGuard } from "./admin-tenant.guard.js";
import { AdminDashboardService } from "./admin-dashboard.service.js";
import type {
  AdminPrincipal,
  AdminRequest
} from "./admin-dashboard.types.js";

@Controller("admin")
@UseGuards(AdminTenantGuard)
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @Get("dashboard")
  getDashboard(@Req() request: AdminRequest) {
    return this.dashboard.getDashboard(this.principal(request));
  }

  private principal(request: AdminRequest): AdminPrincipal {
    if (!request.adminPrincipal) {
      throw new Error(
        "AdminTenantGuard did not attach a tenant principal."
      );
    }
    return request.adminPrincipal;
  }
}
