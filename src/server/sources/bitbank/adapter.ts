import type { BitbankCredentials } from "../../config/secrets.js";
import { ZodError } from "zod";
import type { ZodIssue } from "zod";
import { BitbankHttpClientError } from "./client.js";
import type { BitbankHttpClient } from "./client.js";
import { mapBitbankAssetsToHoldings } from "./mapping.js";
import type { BitbankHttpEndpoint, BitbankHttpErrorMetadata, HoldingSnapshot, SourceObservationError } from "./types.js";

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
      status: "partial";
      error: SourceObservationError;
      holdings: HoldingSnapshot[];
    }
  | {
      scopeId: "bitbank:spot_account";
      observedAt: Date;
      status: "failed";
      error: SourceObservationError;
      holdings: [];
    };

const metadataForBitbankError = (
  endpoint: BitbankHttpEndpoint,
  code: number,
  metadata?: BitbankHttpErrorMetadata,
): BitbankHttpErrorMetadata =>
  metadata ?? {
    endpoint,
    httpStatus: 200,
    bitbankErrorCode: code,
    normalizedErrorCode: code === 10009 ? "rate_limited" : "bitbank_api_error",
    retryable: code === 10009,
    category: "api",
  };

const normalizeBitbankError = (
  endpoint: BitbankHttpEndpoint,
  code: number,
  metadata?: BitbankHttpErrorMetadata,
): SourceObservationError => {
  const safeMetadata = metadataForBitbankError(endpoint, code, metadata);
  if (code === 10009) {
    return {
      code: "rate_limited",
      rawErrorCode: String(code),
      message: "bitbank rate limit exceeded",
      retryable: true,
      category: "api",
      metadata: safeMetadata,
    };
  }

  return {
    code: safeMetadata.normalizedErrorCode,
    rawErrorCode: String(code),
    message: "bitbank API returned an error",
    retryable: safeMetadata.retryable,
    category: safeMetadata.category,
    metadata: safeMetadata,
  };
};

const formatZodIssuePath = (issue: ZodIssue): string => (issue.path.length === 0 ? "response" : issue.path.join("."));

const collectZodIssueMessages = (issues: ZodIssue[]): string[] =>
  issues.flatMap((issue) => {
    if (issue.code === "invalid_union") {
      return issue.errors.flatMap((unionIssues) => collectZodIssueMessages(unionIssues));
    }

    return [`${formatZodIssuePath(issue)}: ${issue.message}`];
  });

const summarizeZodError = (error: ZodError): string => {
  const uniqueMessages = [...new Set(collectZodIssueMessages(error.issues))];
  return uniqueMessages.slice(0, 8).join("; ");
};

const messageForMetadata = (metadata: BitbankHttpErrorMetadata, zodError?: ZodError): string => {
  if (metadata.normalizedErrorCode === "rate_limited") {
    return "bitbank rate limit exceeded";
  }

  if (metadata.normalizedErrorCode === "bitbank_network_error") {
    return "bitbank request failed";
  }

  if (metadata.normalizedErrorCode === "bitbank_non_json_response") {
    return "bitbank API response was not JSON";
  }

  if (metadata.normalizedErrorCode === "bitbank_response_contract_error") {
    const detail = zodError === undefined ? "" : summarizeZodError(zodError);
    return `bitbank API response did not match the expected schema${detail === "" ? "" : `: ${detail}`}`;
  }

  if (metadata.normalizedErrorCode === "bitbank_http_error") {
    const status = metadata.httpStatus === undefined ? "" : ` (${metadata.httpStatus})`;
    return `bitbank API returned an HTTP error${status}`;
  }

  return "bitbank API returned an error";
};

const normalizeUnexpectedError = (error: unknown): SourceObservationError => {
  if (error instanceof BitbankHttpClientError) {
    return {
      code: error.metadata.normalizedErrorCode,
      ...(error.metadata.bitbankErrorCode === undefined ? {} : { rawErrorCode: String(error.metadata.bitbankErrorCode) }),
      message: messageForMetadata(error.metadata, error.zodError),
      retryable: error.metadata.retryable,
      category: error.metadata.category,
      metadata: error.metadata,
    };
  }

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
    code: "bitbank_network_error",
    message: "bitbank request failed",
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
        error: normalizeBitbankError("GET /user/assets", assetsResponse.data.code, assetsResponse.metadata),
        holdings: [],
      };
    }

    const tickersResponse = await client.getTickersJpy();
    if (tickersResponse.success === 0) {
      return {
        scopeId: "bitbank:spot_account",
        observedAt: now,
        status: "failed",
        error: normalizeBitbankError("GET /tickers_jpy", tickersResponse.data.code, tickersResponse.metadata),
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
        holdings: mapped.holdings,
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
