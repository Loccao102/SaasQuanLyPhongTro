import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Pool, type PoolClient } from "pg";

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error("DATABASE_URL is required.");
    }

    const max = Number(process.env.DATABASE_POOL_MAX ?? "10");

    if (!Number.isInteger(max) || max < 1) {
      throw new Error("DATABASE_POOL_MAX must be a positive integer.");
    }

    this.pool = new Pool({
      connectionString,
      max
    });
  }

  async withTransaction<T>(
    operation: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
