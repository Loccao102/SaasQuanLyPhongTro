import { Module } from "@nestjs/common";
import { AccessControlService } from "./access-control.service.js";

@Module({
  providers: [AccessControlService],
  exports: [AccessControlService]
})
export class IdentityModule {}
