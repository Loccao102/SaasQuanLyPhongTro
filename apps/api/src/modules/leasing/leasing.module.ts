import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { LeaseLifecycleApplicationService } from "./application/lease-lifecycle-application.service.js";

@Module({
  imports: [DatabaseModule, IdentityModule, CommercialModule],
  providers: [LeaseLifecycleApplicationService],
  exports: [LeaseLifecycleApplicationService]
})
export class LeasingModule {}
