import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { CmsController } from "./cms.controller.js";
import { CmsOrganizationDirectoryController } from "./cms-organization-directory.controller.js";
import { CmsOrganizationDirectoryService } from "./cms-organization-directory.service.js";
import { CmsPlatformGuard } from "./cms-platform.guard.js";
import { CmsService } from "./cms.service.js";

@Module({
  imports: [
    DatabaseModule,
    CommercialModule,
    NotificationsModule,
    IntegrationsModule
  ],
  controllers: [CmsController, CmsOrganizationDirectoryController],
  providers: [CmsPlatformGuard, CmsService, CmsOrganizationDirectoryService]
})
export class CmsModule {}
