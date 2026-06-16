import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

export const createDb = (databaseUrl = env.DATABASE_URL) => {
  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    throw new Error("DATABASE_URL is not configured");
  }

  const client = postgres(databaseUrl, { max: 1 });
  return drizzle(client, { schema });
};

export type Db = ReturnType<typeof createDb>;
