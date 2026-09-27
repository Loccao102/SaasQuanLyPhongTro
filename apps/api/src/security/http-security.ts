import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export function applyHttpSecurityHeaders(
  request: Request,
  response: Response,
  next: NextFunction
): void {
  const incomingRequestId = request.headers["x-request-id"];
  const candidate = Array.isArray(incomingRequestId)
    ? incomingRequestId[0]
    : incomingRequestId;
  const requestId =
    typeof candidate === "string" && REQUEST_ID_PATTERN.test(candidate)
      ? candidate
      : randomUUID();

  response.setHeader("X-Request-Id", requestId);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
  );
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
  );
  response.setHeader("X-Permitted-Cross-Domain-Policies", "none");

  if (process.env.NODE_ENV === "production") {
    response.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
  }

  if (
    request.path.startsWith("/api/auth") ||
    request.path.startsWith("/api/cms")
  ) {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.setHeader("Pragma", "no-cache");
  }

  next();
}
