import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import {
  MaintenanceController,
  PublicMaintenanceController
} from "./maintenance.controller.js";
import { MaintenanceService } from "./maintenance.service.js";

@Module({
  imports: [DatabaseModule, IdentityModule],
  controllers: [MaintenanceController, PublicMaintenanceController],
  providers: [MaintenanceService],
  exports: [MaintenanceService]
})
export class MaintenanceModule {}
