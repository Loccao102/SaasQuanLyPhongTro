import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { CommercialModule } from "./commercial.module.js";
import { TenantSubscriptionController } from "./tenant-subscription.controller.js";
import { TenantSubscriptionService } from "./application/tenant-subscription.service.js";

@Module({
  imports: [DatabaseModule, IdentityModule, CommercialModule],
  controllers: [TenantSubscriptionController],
  providers: [TenantSubscriptionService],
  exports: [TenantSubscriptionService]
})
export class TenantSubscriptionModule {}
