import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv({ path: ".env.local", override: false });
loadDotenv({ path: ".env", override: false });

const envSchema = z.object({
  DATABASE_URL: z.string().optional(),
  BITBANK_ACCESS_TIME_WINDOW_MS: z.coerce.number().int().positive().default(1000),
  INGESTION_HTTP_REQUEST_TIMEOUT_MS: z
    .string()
    .regex(/^\d+$/, "must be a decimal integer")
    .default("30000")
    .transform(Number)
    .refine((value) => value >= 1000 && value <= 120000, "must be between 1000 and 120000 milliseconds"),
});

export const parseEnv = (input: NodeJS.ProcessEnv) => envSchema.parse(input);

export const env = parseEnv(process.env);
