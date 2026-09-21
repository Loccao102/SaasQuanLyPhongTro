import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

function allowedCorsOrigins(): string[] {
  const configured = process.env.CORS_ORIGINS
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured && configured.length > 0) {
    return configured;
  }

  return [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:3003"
  ];
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true
  });
  app.enableCors({
    origin: allowedCorsOrigins(),
    credentials: true
  });
  app.setGlobalPrefix("api");
  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
