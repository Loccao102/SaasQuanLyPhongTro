import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { RenterBillingController } from "./renter-billing.controller.js";
import { RenterBillingService } from "./renter-billing.service.js";

@Module({
  imports: [DatabaseModule, IdentityModule, CommercialModule],
  controllers: [RenterBillingController],
  providers: [RenterBillingService],
  exports: [RenterBillingService]
})
export class RenterBillingModule {}
