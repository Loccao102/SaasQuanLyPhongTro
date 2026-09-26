import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { CreditBalanceController } from "./credit-balance.controller.js";
import { CreditBalanceService } from "./credit-balance.service.js";
import { RenterPaymentReviewController } from "./renter-payment-review.controller.js";
import { RenterPaymentReviewService } from "./renter-payment-review.service.js";
import { RenterPaymentsController } from "./renter-payments.controller.js";
import { RenterPaymentsService } from "./renter-payments.service.js";
import { RenterPaymentWebhookInboxService } from "./renter-payment-webhook-inbox.service.js";
import { RenterProviderPaymentProcessingService } from "./renter-provider-payment-processing.service.js";

@Module({
  imports: [DatabaseModule, IdentityModule, CommercialModule],
  controllers: [RenterPaymentsController, RenterPaymentReviewController, CreditBalanceController],
  providers: [
    RenterPaymentsService,
    RenterPaymentReviewService,
    RenterPaymentWebhookInboxService,
    RenterProviderPaymentProcessingService,
    CreditBalanceService
  ],
  exports: [
    RenterPaymentsService,
    RenterPaymentReviewService,
    RenterPaymentWebhookInboxService,
    RenterProviderPaymentProcessingService,
    CreditBalanceService
  ]
})
export class RenterPaymentsModule {}
