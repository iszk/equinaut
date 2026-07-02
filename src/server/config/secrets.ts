import { readFileSync } from "node:fs";

export type SecretValue =
  | { status: "available"; value: string }
  | { status: "missing"; reason: string };

export type BitbankCredentials =
  | { status: "available"; apiKey: string; apiSecret: string }
  | { status: "disabled"; reason: "missing bitbank credentials"; missing: string[] };

export type BitflyerCredentials =
  | { status: "available"; apiKey: string; apiSecret: string }
  | { status: "disabled"; reason: "missing bitflyer credentials"; missing: string[] };

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

type ApiCredentialEnv = {
  apiKeyFile?: string | undefined;
  apiSecretFile?: string | undefined;
  apiKey?: string | undefined;
  apiSecret?: string | undefined;
};

const loadApiCredentials = <TDisabledReason extends string>({
  env,
  labels,
  disabledReason,
}: {
  env: ApiCredentialEnv;
  labels: { apiKey: string; apiSecret: string };
  disabledReason: TDisabledReason;
}):
  | { status: "available"; apiKey: string; apiSecret: string }
  | { status: "disabled"; reason: TDisabledReason; missing: string[] } => {
  const apiKey = readSecret({
    filePath: env.apiKeyFile,
    envValue: env.apiKey,
    label: labels.apiKey,
  });
  const apiSecret = readSecret({
    filePath: env.apiSecretFile,
    envValue: env.apiSecret,
    label: labels.apiSecret,
  });

  if (apiKey.status === "missing" || apiSecret.status === "missing") {
    return {
      status: "disabled",
      reason: disabledReason,
      missing: [
        ...(apiKey.status === "missing" ? [labels.apiKey] : []),
        ...(apiSecret.status === "missing" ? [labels.apiSecret] : []),
      ],
    };
  }

  return { status: "available", apiKey: apiKey.value, apiSecret: apiSecret.value };
};

export const loadBitbankCredentials = (env: BitbankCredentialEnv = process.env): BitbankCredentials =>
  loadApiCredentials({
    env: {
      apiKeyFile: env.BITBANK_API_KEY_FILE,
      apiSecretFile: env.BITBANK_API_SECRET_FILE,
      apiKey: env.BITBANK_API_KEY,
      apiSecret: env.BITBANK_API_SECRET,
    },
    labels: { apiKey: "BITBANK_API_KEY", apiSecret: "BITBANK_API_SECRET" },
    disabledReason: "missing bitbank credentials",
  });

type BitflyerCredentialEnv = {
  BITFLYER_API_KEY_FILE?: string | undefined;
  BITFLYER_API_SECRET_FILE?: string | undefined;
  BITFLYER_API_KEY?: string | undefined;
  BITFLYER_API_SECRET?: string | undefined;
};

export const loadBitflyerCredentials = (env: BitflyerCredentialEnv = process.env): BitflyerCredentials =>
  loadApiCredentials({
    env: {
      apiKeyFile: env.BITFLYER_API_KEY_FILE,
      apiSecretFile: env.BITFLYER_API_SECRET_FILE,
      apiKey: env.BITFLYER_API_KEY,
      apiSecret: env.BITFLYER_API_SECRET,
    },
    labels: { apiKey: "BITFLYER_API_KEY", apiSecret: "BITFLYER_API_SECRET" },
    disabledReason: "missing bitflyer credentials",
  });
