import { readFileSync } from "node:fs";

export type SecretValue =
  | { status: "available"; value: string }
  | { status: "missing"; reason: string };

export type BitbankCredentials =
  | { status: "available"; apiKey: string; apiSecret: string }
  | { status: "disabled"; reason: "missing bitbank credentials"; missing: string[] };

type SecretInput = {
  filePath?: string | undefined;
  envValue?: string | undefined;
  label: string;
};

export const readSecret = ({ filePath, envValue, label }: SecretInput): SecretValue => {
  if (filePath !== undefined && filePath.trim() !== "") {
    try {
      const value = readFileSync(filePath, "utf8").trim();
      if (value !== "") {
        return { status: "available", value };
      }
    } catch {
      // Fall through to the env value so a broken secret mount does not crash ingestion.
    }
  }

  if (envValue !== undefined && envValue.trim() !== "") {
    return { status: "available", value: envValue.trim() };
  }

  return { status: "missing", reason: `${label} is not configured` };
};

type BitbankCredentialEnv = {
  BITBANK_API_KEY_FILE?: string | undefined;
  BITBANK_API_SECRET_FILE?: string | undefined;
  BITBANK_API_KEY?: string | undefined;
  BITBANK_API_SECRET?: string | undefined;
};

export const loadBitbankCredentials = (env: BitbankCredentialEnv = process.env): BitbankCredentials => {
  const apiKey = readSecret({
    filePath: env.BITBANK_API_KEY_FILE,
    envValue: env.BITBANK_API_KEY,
    label: "BITBANK_API_KEY",
  });
  const apiSecret = readSecret({
    filePath: env.BITBANK_API_SECRET_FILE,
    envValue: env.BITBANK_API_SECRET,
    label: "BITBANK_API_SECRET",
  });

  if (apiKey.status === "missing" || apiSecret.status === "missing") {
    return {
      status: "disabled",
      reason: "missing bitbank credentials",
      missing: [
        ...(apiKey.status === "missing" ? ["BITBANK_API_KEY"] : []),
        ...(apiSecret.status === "missing" ? ["BITBANK_API_SECRET"] : []),
      ],
    };
  }

  return { status: "available", apiKey: apiKey.value, apiSecret: apiSecret.value };
};
