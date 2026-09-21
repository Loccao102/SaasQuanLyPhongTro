import { Module } from "@nestjs/common";
import { CommercialPolicyService } from "./application/commercial-policy.service.js";
import { SubscriptionManagementService } from "./application/subscription-management.service.js";

@Module({
  providers: [CommercialPolicyService, SubscriptionManagementService],
  exports: [CommercialPolicyService, SubscriptionManagementService]
})
export class CommercialModule {}
