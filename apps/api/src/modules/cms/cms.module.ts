import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../infrastructure/database/database.module.js";
import { CmsController } from "./cms.controller.js";
import { CmsPlatformGuard } from "./cms-platform.guard.js";
import { CmsService } from "./cms.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [CmsController],
  providers: [CmsPlatformGuard, CmsService]
})
export class CmsModule {}
