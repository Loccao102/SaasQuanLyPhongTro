import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { FinancesController } from "./finances.controller.js";
import { FinancesService } from "./finances.service.js";
import { ReportingController } from "./reporting.controller.js";
import { ReportingService } from "./reporting.service.js";

@Module({
  imports: [DatabaseModule, IdentityModule],
  controllers: [FinancesController, ReportingController],
  providers: [FinancesService, ReportingService],
  exports: [FinancesService, ReportingService]
})
export class FinancesModule {}

