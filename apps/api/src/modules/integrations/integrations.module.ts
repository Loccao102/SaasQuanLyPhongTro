import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { InternalServiceGuard } from "../internal/internal-service.guard.js";
import { BillingWebhookIngressService } from "./billing-webhook-ingress.service.js";
import { BillingWebhookInternalController } from "./billing-webhook-internal.controller.js";
import { DevJsonBankWebhookController } from "./dev-json-bank-webhook.controller.js";
import { SePayWebhookController } from "./sepay-webhook.controller.js";
import { DevJsonBankWebhookIngressAdapter } from "./providers/dev-json-bank-webhook-ingress.adapter.js";
import { SePayWebhookIngressAdapter } from "./providers/sepay-webhook-ingress.adapter.js";
import { SaasBillingWebhookProcessingService } from "./saas-billing-webhook-processing.service.js";
import { SaasBillingWebhookInboxService } from "./saas-billing-webhook-inbox.service.js";

@Module({
  imports: [DatabaseModule, CommercialModule],
  controllers: [
    BillingWebhookInternalController,
    DevJsonBankWebhookController,
    SePayWebhookController
  ],
  providers: [
    InternalServiceGuard,
    BillingWebhookIngressService,
    DevJsonBankWebhookIngressAdapter,
    SePayWebhookIngressAdapter,
    SaasBillingWebhookInboxService,
    SaasBillingWebhookProcessingService
  ],
  exports: [
    SaasBillingWebhookInboxService,
    SaasBillingWebhookProcessingService
  ]
})
export class IntegrationsModule {}
