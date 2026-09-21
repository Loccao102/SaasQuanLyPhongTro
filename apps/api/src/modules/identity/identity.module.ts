import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { AccessControlService } from "./access-control.service.js";
import { MembershipApplicationService } from "./application/membership-application.service.js";

@Module({
  imports: [DatabaseModule, CommercialModule],
  providers: [AccessControlService, MembershipApplicationService],
  exports: [AccessControlService, MembershipApplicationService]
})
export class IdentityModule {}
