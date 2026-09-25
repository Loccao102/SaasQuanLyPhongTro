import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { RenterPaymentsModule } from "../renter-payments/renter-payments.module.js";
import { InternalServiceGuard } from "../internal/internal-service.guard.js";
import { BillingWebhookIngressService } from "./billing-webhook-ingress.service.js";
import { BillingWebhookInternalController } from "./billing-webhook-internal.controller.js";
import { DevJsonBankWebhookController } from "./dev-json-bank-webhook.controller.js";
import { DevJsonBankRenterPaymentWebhookController } from "./dev-json-bank-renter-payment-webhook.controller.js";
import { SePayRenterPaymentWebhookController } from "./sepay-renter-payment-webhook.controller.js";
import { SePayProductionReadinessInternalController } from "./sepay-production-readiness-internal.controller.js";
import { SePayProductionReadinessService } from "./sepay-production-readiness.service.js";
import { RenterPaymentWebhookIngressService } from "./renter-payment-webhook-ingress.service.js";
import { RenterPaymentWebhookInternalController } from "./renter-payment-webhook-internal.controller.js";
import { RenterPaymentReconciliationInternalController } from "./renter-payment-reconciliation-internal.controller.js";
import { RenterPaymentReconciliationService } from "./renter-payment-reconciliation.service.js";
import { DevJsonBankWebhookIngressAdapter } from "./providers/dev-json-bank-webhook-ingress.adapter.js";
import { SePayRenterPaymentWebhookIngressAdapter } from "./providers/sepay-renter-payment-webhook-ingress.adapter.js";
import { SaasBillingWebhookProcessingService } from "./saas-billing-webhook-processing.service.js";
import { SaasBillingWebhookInboxService } from "./saas-billing-webhook-inbox.service.js";

@Module({
  imports: [DatabaseModule, CommercialModule, RenterPaymentsModule],
  controllers: [
    BillingWebhookInternalController,
    RenterPaymentWebhookInternalController,
    RenterPaymentReconciliationInternalController,
    SePayProductionReadinessInternalController,
    DevJsonBankWebhookController,
    DevJsonBankRenterPaymentWebhookController,
    SePayRenterPaymentWebhookController
  ],
  providers: [
    InternalServiceGuard,
    BillingWebhookIngressService,
    RenterPaymentWebhookIngressService,
    RenterPaymentReconciliationService,
    SePayProductionReadinessService,
    DevJsonBankWebhookIngressAdapter,
    SePayRenterPaymentWebhookIngressAdapter,
    SaasBillingWebhookInboxService,
    SaasBillingWebhookProcessingService
  ],
  exports: [
    SaasBillingWebhookInboxService,
    SaasBillingWebhookProcessingService
  ]
})
export class IntegrationsModule {}
