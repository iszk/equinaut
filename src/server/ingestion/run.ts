import { loadBitbankCredentials } from "../config/secrets.js";
import { createBitbankHttpClient } from "../sources/bitbank/client.js";
import { collectBitbankSpotAccount } from "../sources/bitbank/adapter.js";

export type IngestionRunResult = {
  status: "success" | "partial" | "failed";
  message: string;
};

export const runBitbankIngestion = async (): Promise<IngestionRunResult> => {
  const credentials = loadBitbankCredentials();
  if (credentials.status === "disabled") {
    return { status: "failed", message: "bitbank adapter disabled: missing credentials" };
  }

  const client = createBitbankHttpClient({ credentials });
  const result = await collectBitbankSpotAccount({ credentials, client });

  if (result.status === "success") {
    return { status: "success", message: `bitbank ingestion succeeded: ${result.holdings.length} holdings collected` };
  }

  return { status: result.status, message: `bitbank ingestion ${result.status}: ${result.error.code}` };
};
