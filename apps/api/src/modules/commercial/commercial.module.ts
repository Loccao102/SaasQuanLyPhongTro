import { Module } from "@nestjs/common";
import { InternalServiceGuard } from "../internal/internal-service.guard.js";
import { DatabaseModule } from "../database/database.module.js";
import { AutomationQuotaService } from "./application/automation-quota.service.js";
import { CommercialPolicyService } from "./application/commercial-policy.service.js";
import { SubscriptionBillingService } from "./application/subscription-billing.service.js";
import { SubscriptionManagementService } from "./application/subscription-management.service.js";
import { BillingInternalController } from "./billing-internal.controller.js";

@Module({
  imports: [DatabaseModule],
  controllers: [BillingInternalController],
  providers: [
    InternalServiceGuard,
    CommercialPolicyService,
    SubscriptionManagementService,
    SubscriptionBillingService,
    AutomationQuotaService
  ],
  exports: [
    CommercialPolicyService,
    SubscriptionManagementService,
    SubscriptionBillingService,
    AutomationQuotaService
  ]
})
export class CommercialModule {}
