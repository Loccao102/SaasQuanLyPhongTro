import { Module } from "@nestjs/common";
import { HealthModule } from "./modules/health/health.module.js";
import { IdentityModule } from "./modules/identity/identity.module.js";
import { LeasingModule } from "./modules/leasing/leasing.module.js";
import { PropertiesModule } from "./modules/properties/properties.module.js";

@Module({
  imports: [HealthModule, IdentityModule, PropertiesModule, LeasingModule]
})
export class AppModule {}
