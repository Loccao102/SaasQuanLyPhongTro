import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { SaasBillingWebhookInboxService } from "./saas-billing-webhook-inbox.service.js";

@Module({
  imports: [DatabaseModule],
  providers: [SaasBillingWebhookInboxService],
  exports: [SaasBillingWebhookInboxService]
})
export class IntegrationsModule {}
