import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv({ path: ".env.local", override: false });
loadDotenv({ path: ".env", override: false });

const envSchema = z.object({
  DATABASE_URL: z.string().optional(),
  BITBANK_ACCESS_TIME_WINDOW_MS: z.coerce.number().int().positive().default(1000),
});

export const env = envSchema.parse(process.env);
