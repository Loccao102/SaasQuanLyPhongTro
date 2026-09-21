import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { InternalServiceGuard } from "../internal/internal-service.guard.js";
import { BillingWebhookInternalController } from "./billing-webhook-internal.controller.js";
import { SaasBillingWebhookProcessingService } from "./saas-billing-webhook-processing.service.js";
import { SaasBillingWebhookInboxService } from "./saas-billing-webhook-inbox.service.js";

@Module({
  imports: [DatabaseModule, CommercialModule],
  controllers: [BillingWebhookInternalController],
  providers: [
    InternalServiceGuard,
    SaasBillingWebhookInboxService,
    SaasBillingWebhookProcessingService
  ],
  exports: [
    SaasBillingWebhookInboxService,
    SaasBillingWebhookProcessingService
  ]
})
export class IntegrationsModule {}
