import type { BitbankCredentials } from "../../config/secrets.js";
import type { BitbankHttpClient } from "./client.js";
import { mapBitbankAssetsToHoldings } from "./mapping.js";
import type { HoldingSnapshot, SourceObservationError } from "./types.js";

type CollectInput = {
  credentials: BitbankCredentials;
  client: BitbankHttpClient;
  now?: Date;
};

type ScopeObservationResult =
  | {
      scopeId: "bitbank:spot_account";
      observedAt: Date;
      status: "success";
      holdings: HoldingSnapshot[];
    }
  | {
      scopeId: "bitbank:spot_account";
      observedAt: Date;
      status: "partial" | "failed";
      error: SourceObservationError;
      holdings: [];
    };

const normalizeBitbankError = (code: number): SourceObservationError => {
  if (code === 10009) {
    return {
      code: "rate_limited",
      rawErrorCode: String(code),
      message: "bitbank rate limit exceeded",
      retryable: true,
      category: "api",
    };
  }

  return {
    code: "bitbank_api_error",
    rawErrorCode: String(code),
    message: "bitbank API returned an error",
    retryable: false,
    category: "api",
  };
};

export const collectBitbankSpotAccount = async ({
  credentials,
  client,
  now = new Date(),
}: CollectInput): Promise<ScopeObservationResult> => {
  if (credentials.status === "disabled") {
    return {
      scopeId: "bitbank:spot_account",
      observedAt: now,
      status: "failed",
      error: {
        code: "configuration_error",
        message: credentials.reason,
        retryable: false,
        category: "configuration",
      },
      holdings: [],
    };
  }

  const assetsResponse = await client.getUserAssets();
  if (assetsResponse.success === 0) {
    return {
      scopeId: "bitbank:spot_account",
      observedAt: now,
      status: "failed",
      error: normalizeBitbankError(assetsResponse.data.code),
      holdings: [],
    };
  }

  const tickersResponse = await client.getTickersJpy();
  if (tickersResponse.success === 0) {
    return {
      scopeId: "bitbank:spot_account",
      observedAt: now,
      status: "failed",
      error: normalizeBitbankError(tickersResponse.data.code),
      holdings: [],
    };
  }

  const mapped = mapBitbankAssetsToHoldings({ assets: assetsResponse.data.assets, tickers: tickersResponse.data });
  if (mapped.status === "partial") {
    return {
      scopeId: "bitbank:spot_account",
      observedAt: now,
      status: "partial",
      error: mapped.error,
      holdings: [],
    };
  }

  return {
    scopeId: "bitbank:spot_account",
    observedAt: now,
    status: "success",
    holdings: mapped.holdings,
  };
};
