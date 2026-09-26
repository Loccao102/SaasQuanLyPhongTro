import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { LeaseAdminController } from "./application/lease-admin.controller.js";
import { LeaseAdminService } from "./application/lease-admin.service.js";
import { LeaseLifecycleApplicationService } from "./application/lease-lifecycle-application.service.js";
import { LeaseDraftManagementController } from "./application/lease-draft-management.controller.js";
import { LeaseDraftManagementService } from "./application/lease-draft-management.service.js";
import { LeaseDepositController } from "./application/lease-deposit.controller.js";
import { LeaseDepositService } from "./application/lease-deposit.service.js";
import { LeaseTerminationReadinessController } from "./application/lease-termination-readiness.controller.js";
import { LeaseTerminationReadinessService } from "./application/lease-termination-readiness.service.js";

@Module({
  imports: [DatabaseModule, IdentityModule, CommercialModule],
  controllers: [
    LeaseAdminController,
    LeaseTerminationReadinessController,
    LeaseDraftManagementController,
    LeaseDepositController
  ],
  providers: [
    LeaseLifecycleApplicationService,
    LeaseAdminService,
    LeaseTerminationReadinessService,
    LeaseDraftManagementService,
    LeaseDepositService
  ],
  exports: [
    LeaseLifecycleApplicationService,
    LeaseAdminService,
    LeaseTerminationReadinessService,
    LeaseDraftManagementService,
    LeaseDepositService
  ]
})
export class LeasingModule {}
