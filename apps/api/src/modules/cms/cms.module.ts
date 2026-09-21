import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { CmsController } from "./cms.controller.js";
import { CmsPlatformGuard } from "./cms-platform.guard.js";
import { CmsService } from "./cms.service.js";

@Module({
  imports: [DatabaseModule, CommercialModule],
  controllers: [CmsController],
  providers: [CmsPlatformGuard, CmsService]
})
export class CmsModule {}
