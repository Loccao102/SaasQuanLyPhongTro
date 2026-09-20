import { Global, Module } from "@nestjs/common";
import { PostgresService } from "./postgres.service.js";

@Global()
@Module({
  providers: [PostgresService],
  exports: [PostgresService]
})
export class DatabaseModule {}
