import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { PricingController } from "./pricing.controller.js";
import { PricingService } from "./pricing.service.js";

@Module({
  imports: [DatabaseModule, IdentityModule, CommercialModule],
  controllers: [PricingController],
  providers: [PricingService],
  exports: [PricingService]
})
export class PricingModule {}
