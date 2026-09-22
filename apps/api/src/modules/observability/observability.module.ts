import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { DatabaseModule } from "../database/database.module.js";
import { InternalServiceGuard } from "../internal/internal-service.guard.js";
import { ApiRequestMetricsInterceptor } from "./api-request-metrics.interceptor.js";
import { ObservabilityInternalController } from "./observability-internal.controller.js";
import { ObservabilityMetricsController } from "./observability-metrics.controller.js";
import { ObservabilityMetricsGuard } from "./observability-metrics.guard.js";
import { ObservabilityService } from "./observability.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [
    ObservabilityInternalController,
    ObservabilityMetricsController
  ],
  providers: [
    InternalServiceGuard,
    ObservabilityMetricsGuard,
    ObservabilityService,
    {
      provide: APP_INTERCEPTOR,
      useClass: ApiRequestMetricsInterceptor
    }
  ],
  exports: [ObservabilityService]
})
export class ObservabilityModule {}
