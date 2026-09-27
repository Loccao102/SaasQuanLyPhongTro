import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { allowedBrowserOrigins } from "./modules/identity/auth/auth-http.js";
import { applyHttpSecurityHeaders } from "./security/http-security.js";
import {
  assertSecurityConfiguration,
  configuredTrustProxyHops
} from "./security/security-config.js";

async function bootstrap() {
  assertSecurityConfiguration();

  const app = await NestFactory.create(AppModule, {
    rawBody: true
  });

  const express = app.getHttpAdapter().getInstance();
  express.disable("x-powered-by");

  const trustProxyHops = configuredTrustProxyHops();
  if (trustProxyHops > 0) {
    express.set("trust proxy", trustProxyHops);
  }

  app.use(applyHttpSecurityHeaders);
  app.enableCors({
    origin: allowedBrowserOrigins(),
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Organization-Id",
      "X-Idempotency-Key",
      "X-CSRF-Token",
      "X-Request-Id"
    ],
    exposedHeaders: ["X-Request-Id"],
    maxAge: 600
  });
  app.setGlobalPrefix("api");
  app.enableShutdownHooks();

  const port = Number(process.env.API_PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("API_PORT must be a valid TCP port.");
  }

  await app.listen(port, "0.0.0.0");
}

void bootstrap();
