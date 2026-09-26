import { Module } from "@nestjs/common";
import { CmsModule } from "./modules/cms/cms.module.js";
import { CommercialModule } from "./modules/commercial/commercial.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { IdentityModule } from "./modules/identity/identity.module.js";
import { IntegrationsModule } from "./modules/integrations/integrations.module.js";
import { LeasingModule } from "./modules/leasing/leasing.module.js";
import { MeteringModule } from "./modules/metering/metering.module.js";
import { NotificationsModule } from "./modules/notifications/notifications.module.js";
import { PricingModule } from "./modules/pricing/pricing.module.js";
import { ObservabilityModule } from "./modules/observability/observability.module.js";
import { PropertiesModule } from "./modules/properties/properties.module.js";
import { RenterBillingModule } from "./modules/renter-billing/renter-billing.module.js";
import { RenterPaymentsModule } from "./modules/renter-payments/renter-payments.module.js";
import { FinancesModule } from "./modules/finances/finances.module.js";
import { MaintenanceModule } from "./modules/maintenance/maintenance.module.js";

@Module({
  imports: [
    HealthModule,
    IdentityModule,
    PropertiesModule,
    LeasingModule,
    PricingModule,
    MeteringModule,
    RenterBillingModule,
    RenterPaymentsModule,
    FinancesModule,
    MaintenanceModule,
    CommercialModule,
    IntegrationsModule,
    NotificationsModule,
    ObservabilityModule,
    CmsModule
  ]
})
export class AppModule {}
