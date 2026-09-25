import { Controller, Get, UseGuards } from "@nestjs/common";
import { InternalServiceGuard } from "../internal/internal-service.guard.js";
import { SePayProductionReadinessService } from "./sepay-production-readiness.service.js";

@Controller("internal/integrations/sepay")
@UseGuards(InternalServiceGuard)
export class SePayProductionReadinessInternalController {
  constructor(
    private readonly readiness: SePayProductionReadinessService
  ) {}

  @Get("readiness")
  getReadiness() {
    return {
      generatedAt: new Date().toISOString(),
      webhook: this.readiness.webhook()
    };
  }
}
