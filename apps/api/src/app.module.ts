import { Module } from "@nestjs/common";
import { CmsModule } from "./modules/cms/cms.module.js";
import { CommercialModule } from "./modules/commercial/commercial.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { IdentityModule } from "./modules/identity/identity.module.js";
import { LeasingModule } from "./modules/leasing/leasing.module.js";
import { PropertiesModule } from "./modules/properties/properties.module.js";

@Module({
  imports: [
    HealthModule,
    IdentityModule,
    PropertiesModule,
    LeasingModule,
    CommercialModule,
    CmsModule
  ]
})
export class AppModule {}
