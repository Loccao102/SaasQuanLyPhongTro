import {
  Controller,
  Get,
  Header,
  UseGuards
} from "@nestjs/common";
import { renderPrometheusMetrics } from "./observability-metrics.js";
import { ObservabilityMetricsGuard } from "./observability-metrics.guard.js";
import { ObservabilityService } from "./observability.service.js";

@Controller("metrics")
@UseGuards(ObservabilityMetricsGuard)
export class ObservabilityMetricsController {
  constructor(private readonly observability: ObservabilityService) {}

  @Get()
  @Header(
    "Content-Type",
    "text/plain; version=0.0.4; charset=utf-8"
  )
  async metrics(): Promise<string> {
    return renderPrometheusMetrics(
      await this.observability.getOperationalSnapshot()
    );
  }
}
