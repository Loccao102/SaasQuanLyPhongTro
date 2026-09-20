import { Module } from "@nestjs/common";
import { CmsModule } from "./modules/cms/cms.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { IdentityModule } from "./modules/identity/identity.module.js";
import { PropertiesModule } from "./modules/properties/properties.module.js";

@Module({
  imports: [HealthModule, IdentityModule, PropertiesModule, CmsModule]
})
export class AppModule {}
