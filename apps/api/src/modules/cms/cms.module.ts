import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { CmsController } from "./cms.controller.js";
import { CmsGlobalSearchController } from "./cms-global-search.controller.js";
import { CmsGlobalSearchService } from "./cms-global-search.service.js";
import { CmsBillingDetailController } from "./cms-billing-detail.controller.js";
import { CmsBillingDetailService } from "./cms-billing-detail.service.js";
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
  controllers: [CmsController, CmsOrganizationDirectoryController, CmsBillingDetailController, CmsGlobalSearchController],
  providers: [CmsPlatformGuard, CmsService, CmsOrganizationDirectoryService, CmsBillingDetailService, CmsGlobalSearchService]
})
export class CmsModule {}
