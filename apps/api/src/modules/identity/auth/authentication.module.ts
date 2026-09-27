import { Module } from "@nestjs/common";
import { CommercialModule } from "../../commercial/commercial.module.js";
import { DatabaseModule } from "../../database/database.module.js";
import { AuthenticationController } from "./authentication.controller.js";
import { AuthSecurityService } from "./auth-security.service.js";
import { AuthenticationRepository } from "./authentication.repository.js";
import { AuthenticationService } from "./authentication.service.js";
import { TenantOnboardingService } from "./tenant-onboarding.service.js";

@Module({
  imports: [DatabaseModule, CommercialModule],
  controllers: [AuthenticationController],
  providers: [
    AuthenticationRepository,
    AuthenticationService,
    AuthSecurityService,
    TenantOnboardingService
  ],
  exports: [AuthenticationService, AuthSecurityService]
})
export class AuthenticationModule {}
