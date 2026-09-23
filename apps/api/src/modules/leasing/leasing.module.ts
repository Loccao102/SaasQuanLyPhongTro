import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { LeaseAdminController } from "./application/lease-admin.controller.js";
import { LeaseAdminService } from "./application/lease-admin.service.js";
import { LeaseLifecycleApplicationService } from "./application/lease-lifecycle-application.service.js";

@Module({
  imports: [DatabaseModule, IdentityModule, CommercialModule],
  controllers: [LeaseAdminController],
  providers: [LeaseLifecycleApplicationService, LeaseAdminService],
  exports: [LeaseLifecycleApplicationService, LeaseAdminService]
})
export class LeasingModule {}
