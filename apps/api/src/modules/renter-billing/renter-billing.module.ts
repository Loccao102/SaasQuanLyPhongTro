import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { MeteringModule } from "../metering/metering.module.js";
import { PricingModule } from "../pricing/pricing.module.js";
import { RenterBillingController } from "./renter-billing.controller.js";
import { RenterPaymentsModule } from "../renter-payments/renter-payments.module.js";
import { RenterBillingService } from "./renter-billing.service.js";
import { RenterPublicInvoiceController } from "./renter-public-invoice.controller.js";
import { RenterPublicInvoiceService } from "./renter-public-invoice.service.js";
import { RenterInvoiceNotificationService } from "./renter-invoice-notification.service.js";
import { NotificationsModule } from "../notifications/notifications.module.js";

@Module({
  imports: [
    DatabaseModule,
    IdentityModule,
    CommercialModule,
    PricingModule,
    MeteringModule,
    RenterPaymentsModule,
    NotificationsModule
  ],
  controllers: [RenterBillingController, RenterPublicInvoiceController],
  providers: [
    RenterBillingService,
    RenterPublicInvoiceService,
    RenterInvoiceNotificationService
  ],
  exports: [RenterBillingService, RenterPublicInvoiceService]
})
export class RenterBillingModule {}
