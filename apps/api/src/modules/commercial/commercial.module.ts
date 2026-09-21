import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { AutomationQuotaService } from "./application/automation-quota.service.js";
import { CommercialPolicyService } from "./application/commercial-policy.service.js";
import { SubscriptionManagementService } from "./application/subscription-management.service.js";

@Module({
  imports: [DatabaseModule],
  providers: [
    CommercialPolicyService,
    SubscriptionManagementService,
    AutomationQuotaService
  ],
  exports: [
    CommercialPolicyService,
    SubscriptionManagementService,
    AutomationQuotaService
  ]
})
export class CommercialModule {}
