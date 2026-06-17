import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

export const createDbClient = (databaseUrl = env.DATABASE_URL) => {
  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    throw new Error("DATABASE_URL is not configured");
  }

  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client, { schema });

  return {
    db,
    close: async () => {
      await client.end();
    },
  };
};

export const createDb = (databaseUrl = env.DATABASE_URL) => createDbClient(databaseUrl).db;

export type Db = ReturnType<typeof createDb>;
export type DbClient = ReturnType<typeof createDbClient>;
