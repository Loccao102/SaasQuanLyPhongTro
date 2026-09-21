import { Module } from "@nestjs/common";
import { CommercialPolicyService } from "./application/commercial-policy.service.js";

@Module({
  providers: [CommercialPolicyService],
  exports: [CommercialPolicyService]
})
export class CommercialModule {}
