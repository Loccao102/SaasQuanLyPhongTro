import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { AdminDashboardController } from "./admin-dashboard.controller.js";
import { AdminDashboardService } from "./admin-dashboard.service.js";
import { AdminTenantGuard } from "./admin-tenant.guard.js";

@Module({
  imports: [DatabaseModule, CommercialModule],
  controllers: [AdminDashboardController],
  providers: [AdminTenantGuard, AdminDashboardService],
  exports: [AdminDashboardService]
})
export class ReportingModule {}
