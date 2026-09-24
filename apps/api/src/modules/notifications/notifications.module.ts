import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { NotificationAdminController } from "./application/notification-admin.controller.js";
import { NotificationAdminService } from "./application/notification-admin.service.js";
import { NotificationCampaignService } from "./application/notification-campaign.service.js";
import { NotificationOperationsService } from "./application/notification-operations.service.js";
import { NotificationWorkerService } from "./application/notification-worker.service.js";
import { NotificationInternalController } from "./notification-internal.controller.js";
import { InternalServiceGuard } from "../internal/internal-service.guard.js";

@Module({
  imports: [DatabaseModule, IdentityModule, CommercialModule],
  controllers: [NotificationInternalController, NotificationAdminController],
  providers: [
    InternalServiceGuard,
    NotificationAdminService,
    NotificationCampaignService,
    NotificationWorkerService,
    NotificationOperationsService
  ],
  exports: [
    NotificationCampaignService,
    NotificationWorkerService,
    NotificationOperationsService
  ]
})
export class NotificationsModule {}
