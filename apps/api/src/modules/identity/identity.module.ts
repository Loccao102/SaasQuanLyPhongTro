import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { AccessControlService } from "./access-control.service.js";
import { MembershipApplicationService } from "./application/membership-application.service.js";
import { MembershipInvitationController } from "./application/membership-invitation.controller.js";
import { MembershipInvitationService } from "./application/membership-invitation.service.js";
import { TeamManagementController } from "./application/team-management.controller.js";
import { TeamManagementService } from "./application/team-management.service.js";
import { AuthenticationModule } from "./auth/authentication.module.js";
import { TenantPrincipalGuard } from "./tenant-principal.guard.js";

@Module({
  imports: [DatabaseModule, CommercialModule, AuthenticationModule],
  controllers: [TeamManagementController, MembershipInvitationController],
  providers: [
    AccessControlService,
    MembershipApplicationService,
    MembershipInvitationService,
    TeamManagementService,
    TenantPrincipalGuard
  ],
  exports: [
    AccessControlService,
    MembershipApplicationService,
    TeamManagementService,
    TenantPrincipalGuard,
    AuthenticationModule
  ]
})
export class IdentityModule {}
