import { timingSafeEqual } from "node:crypto";
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";

type MetricsRequest = {
  headers?: {
    authorization?: string | string[];
  };
};

@Injectable()
export class ObservabilityMetricsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.OBSERVABILITY_METRICS_TOKEN?.trim();
    if (!expected || expected.length < 16) {
      throw new UnauthorizedException(
        "Observability metrics authentication is not configured."
      );
    }

    const request = context.switchToHttp().getRequest<MetricsRequest>();
    const rawAuthorization = request.headers?.authorization;
    const authorization = Array.isArray(rawAuthorization)
      ? rawAuthorization[0]
      : rawAuthorization;

    if (!authorization?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Metrics bearer token is required.");
    }

    const actual = authorization.slice("Bearer ".length).trim();
    const expectedBytes = Buffer.from(expected);
    const actualBytes = Buffer.from(actual);

    if (
      expectedBytes.length !== actualBytes.length ||
      !timingSafeEqual(expectedBytes, actualBytes)
    ) {
      throw new UnauthorizedException("Invalid metrics bearer token.");
    }

    return true;
  }
}
