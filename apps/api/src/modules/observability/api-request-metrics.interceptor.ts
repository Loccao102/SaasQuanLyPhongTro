import {
  CallHandler,
  ExecutionContext,
  Injectable,
  type NestInterceptor
} from "@nestjs/common";
import {
  Observable,
  catchError,
  finalize,
  throwError
} from "rxjs";
import { ObservabilityService } from "./observability.service.js";

type HttpRequest = {
  originalUrl?: string;
  url?: string;
};

type HttpResponse = {
  statusCode?: number;
};

@Injectable()
export class ApiRequestMetricsInterceptor implements NestInterceptor {
  constructor(private readonly observability: ObservabilityService) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler
  ): Observable<unknown> {
    if (context.getType() !== "http") {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequest>();
    const response = http.getResponse<HttpResponse>();
    const url = request.originalUrl ?? request.url ?? "";
    if (url.endsWith("/metrics")) {
      return next.handle();
    }

    const startedAt = process.hrtime.bigint();
    let errorStatus: number | null = null;

    return next.handle().pipe(
      catchError((error: unknown) => {
        errorStatus =
          typeof error === "object" &&
          error !== null &&
          "getStatus" in error &&
          typeof (error as { getStatus?: unknown }).getStatus === "function"
            ? Number(
                (
                  error as {
                    getStatus: () => number;
                  }
                ).getStatus()
              )
            : 500;
        return throwError(() => error);
      }),
      finalize(() => {
        const durationMs =
          Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        this.observability.observeHttpRequest(
          errorStatus ?? Number(response.statusCode ?? 200),
          durationMs
        );
      })
    );
  }
}
