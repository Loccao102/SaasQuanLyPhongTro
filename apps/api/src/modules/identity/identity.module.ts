import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { AccessControlService } from "./access-control.service.js";
import { MembershipApplicationService } from "./application/membership-application.service.js";
import { TeamManagementController } from "./application/team-management.controller.js";
import { TeamManagementService } from "./application/team-management.service.js";
import { TenantPrincipalGuard } from "./tenant-principal.guard.js";

@Module({
  imports: [DatabaseModule, CommercialModule],
  controllers: [TeamManagementController],
  providers: [AccessControlService, MembershipApplicationService, TeamManagementService, TenantPrincipalGuard],
  exports: [AccessControlService, MembershipApplicationService, TeamManagementService, TenantPrincipalGuard]
})
export class IdentityModule {}
