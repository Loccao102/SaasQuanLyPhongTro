import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { allowedBrowserOrigins } from "./modules/identity/auth/auth-http.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true
  });
  app.enableCors({
    origin: allowedBrowserOrigins(),
    credentials: true,
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Organization-Id",
      "X-Idempotency-Key",
      "X-CSRF-Token"
    ]
  });
  app.setGlobalPrefix("api");
  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
