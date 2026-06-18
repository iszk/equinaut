import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import type { Db } from "./index.js";

loadDotenv({ path: ".env.local", override: false });
loadDotenv({ path: ".env", override: false });

type TestDatabaseContext = {
  db: Db;
  schemaName: string;
};

type TestSchemaCleanupClient = {
  unsafe(statement: string): Promise<unknown>;
  end(): Promise<void>;
};

const migrationsDirectory = "drizzle";

const createSchemaName = () => `test_${randomBytes(8).toString("hex")}`;

export const isTestDatabaseUrlConfigured = (databaseUrl: string | undefined): databaseUrl is string =>
  databaseUrl !== undefined && databaseUrl.trim() !== "";

const quoteSchemaLiteral = (schemaName: string) => {
  if (!/^test_[a-f0-9]{16}$/u.test(schemaName)) {
    throw new Error(`Invalid test schema name: ${schemaName}`);
  }

  return `"${schemaName}"`;
};

const migrationStatements = async (schemaName: string): Promise<string[]> => {
  const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
  const schemaReference = quoteSchemaLiteral(schemaName);
  const statements: string[] = [];

  for (const file of files) {
    const content = await readFile(join(migrationsDirectory, file), "utf8");
    const rewritten = content
      .replace('CREATE EXTENSION IF NOT EXISTS "pgcrypto";', 'CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA public;')
      .replaceAll('"public".', `${schemaReference}.`);

    statements.push(
      ...rewritten
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0),
    );
  }

  return statements;
};

const migrateTestSchema = async (sql: postgres.Sql, schemaName: string): Promise<void> => {
  for (const statement of await migrationStatements(schemaName)) {
    await sql.unsafe(statement);
  }
};

export const cleanupTestSchema = async (sql: TestSchemaCleanupClient, schemaName: string): Promise<void> => {
  try {
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${quoteSchemaLiteral(schemaName)} CASCADE`);
  } finally {
    await sql.end();
  }
};

export const withTestDatabase = async <T>(fn: (context: TestDatabaseContext) => Promise<T>): Promise<T> => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!isTestDatabaseUrlConfigured(databaseUrl)) {
    throw new Error("TEST_DATABASE_URL is not configured");
  }

  const schemaName = createSchemaName();
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  const db = drizzle(sql, { schema });

  try {
    await sql`CREATE SCHEMA ${sql(schemaName)}`;
    await sql`SET search_path TO ${sql(schemaName)}, public`;
    await migrateTestSchema(sql, schemaName);

    return await fn({ db, schemaName });
  } finally {
    await cleanupTestSchema(sql, schemaName);
  }
};
