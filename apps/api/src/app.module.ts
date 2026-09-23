import { Module } from "@nestjs/common";
import { CmsModule } from "./modules/cms/cms.module.js";
import { CommercialModule } from "./modules/commercial/commercial.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { IdentityModule } from "./modules/identity/identity.module.js";
import { IntegrationsModule } from "./modules/integrations/integrations.module.js";
import { LeasingModule } from "./modules/leasing/leasing.module.js";
import { NotificationsModule } from "./modules/notifications/notifications.module.js";
import { PropertiesModule } from "./modules/properties/properties.module.js";
import { ReportingModule } from "./modules/reporting/reporting.module.js";

@Module({
  imports: [
    HealthModule,
    IdentityModule,
    PropertiesModule,
    LeasingModule,
    CommercialModule,
    IntegrationsModule,
    NotificationsModule,
    ReportingModule,
    CmsModule
  ]
})
export class AppModule {}
