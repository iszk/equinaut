import type { BitbankCredentials } from "../../config/secrets.js";
import { ZodError } from "zod";
import type { ZodIssue } from "zod";
import type { BitbankHttpClient } from "./client.js";
import { mapBitbankAssetsToHoldings } from "./mapping.js";
import type { HoldingSnapshot, SourceObservationError } from "./types.js";

type CollectInput = {
  credentials: BitbankCredentials;
  client: BitbankHttpClient;
  now?: Date;
};

export type ScopeObservationResult =
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

const formatZodIssuePath = (issue: ZodIssue): string => (issue.path.length === 0 ? "response" : issue.path.join("."));

const collectZodIssueMessages = (issues: ZodIssue[]): string[] =>
  issues.flatMap((issue) => {
    if (issue.code === "invalid_union") {
      return issue.unionErrors.flatMap((unionError) => collectZodIssueMessages(unionError.issues));
    }

    return [`${formatZodIssuePath(issue)}: ${issue.message}`];
  });

const summarizeZodError = (error: ZodError): string => {
  const uniqueMessages = [...new Set(collectZodIssueMessages(error.issues))];
  return uniqueMessages.slice(0, 8).join("; ");
};

const normalizeUnexpectedError = (error: unknown): SourceObservationError => {
  if (error instanceof ZodError) {
    const detail = summarizeZodError(error);
    return {
      code: "bitbank_response_contract_error",
      message: `bitbank API response did not match the expected schema${detail === "" ? "" : `: ${detail}`}`,
      retryable: false,
      category: "contract",
    };
  }

  return {
    code: "bitbank_request_failed",
    message: error instanceof Error ? error.message : "bitbank request failed",
    retryable: true,
    category: "network",
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

  try {
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
  } catch (error) {
    return {
      scopeId: "bitbank:spot_account",
      observedAt: now,
      status: "failed",
      error: normalizeUnexpectedError(error),
      holdings: [],
    };
  }
};
