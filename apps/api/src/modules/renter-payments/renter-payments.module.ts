import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { RenterPaymentsController } from "./renter-payments.controller.js";
import { RenterPaymentsService } from "./renter-payments.service.js";

@Module({
  imports: [DatabaseModule, IdentityModule, CommercialModule],
  controllers: [RenterPaymentsController],
  providers: [RenterPaymentsService],
  exports: [RenterPaymentsService]
})
export class RenterPaymentsModule {}
