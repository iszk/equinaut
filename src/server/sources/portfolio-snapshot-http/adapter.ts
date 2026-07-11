import { ZodError } from "zod";
import type { ZodIssue } from "zod";
import type { ScopeObservationResult, SourceObservationError } from "../../ingestion/source-types.js";
import { PortfolioSnapshotHttpClientError } from "./client.js";
import { mapPortfolioSnapshotToHoldings } from "./mapping.js";
import type { PortfolioSnapshotHttpClient, PortfolioSnapshotHttpErrorMetadata, PortfolioSnapshotHttpSourceConfig } from "./types.js";

type CollectInput = {
  sourceConfig: PortfolioSnapshotHttpSourceConfig;
  client: PortfolioSnapshotHttpClient;
  now?: Date;
};

const formatZodIssuePath = (issue: ZodIssue): string => (issue.path.length === 0 ? "response" : issue.path.join("."));

const collectZodIssueMessages = (issues: ZodIssue[]): string[] =>
  issues.flatMap((issue) => {
    if (issue.code === "invalid_union") {
      if (issue.errors.length === 0) {
        return [`${formatZodIssuePath(issue)}: ${issue.message}`];
      }

      return issue.errors.flatMap((unionIssues) => collectZodIssueMessages(unionIssues));
    }

    return [`${formatZodIssuePath(issue)}: ${issue.message}`];
  });

const summarizeZodError = (error: ZodError): string => {
  const uniqueMessages = [...new Set(collectZodIssueMessages(error.issues))];
  return uniqueMessages.slice(0, 8).join("; ");
};

const messageForMetadata = (metadata: PortfolioSnapshotHttpErrorMetadata, zodError?: ZodError): string => {
  if (metadata.normalizedErrorCode === "rate_limited") {
    return "portfolio snapshot API rate limit exceeded";
  }

  if (metadata.normalizedErrorCode === "portfolio_snapshot_network_error") {
    return "portfolio snapshot request failed";
  }

  if (metadata.normalizedErrorCode === "portfolio_snapshot_non_json_response") {
    return "portfolio snapshot API response was not JSON";
  }

  if (metadata.normalizedErrorCode === "portfolio_snapshot_response_contract_error") {
    const detail = zodError === undefined ? "" : summarizeZodError(zodError);
    return `portfolio snapshot API response did not match the expected schema${detail === "" ? "" : `: ${detail}`}`;
  }

  if (metadata.normalizedErrorCode === "portfolio_snapshot_http_error") {
    const status = metadata.httpStatus === undefined ? "" : ` (${metadata.httpStatus})`;
    return `portfolio snapshot API returned an HTTP error${status}`;
  }

  return "portfolio snapshot API returned an error";
};

const normalizeUnexpectedError = (error: unknown): SourceObservationError => {
  if (error instanceof PortfolioSnapshotHttpClientError) {
    return {
      code: error.metadata.normalizedErrorCode,
      ...(error.metadata.rawErrorCode === undefined ? {} : { rawErrorCode: error.metadata.rawErrorCode }),
      message: messageForMetadata(error.metadata, error.zodError),
      retryable: error.metadata.retryable,
      category: error.metadata.category,
      metadata: error.metadata,
    };
  }

  if (error instanceof ZodError) {
    const detail = summarizeZodError(error);
    return {
      code: "portfolio_snapshot_response_contract_error",
      message: `portfolio snapshot API response did not match the expected schema${detail === "" ? "" : `: ${detail}`}`,
      retryable: false,
      category: "contract",
    };
  }

  return {
    code: "portfolio_snapshot_network_error",
    message: "portfolio snapshot request failed",
    retryable: true,
    category: "network",
  };
};

export const collectPortfolioSnapshotHttpSource = async ({
  sourceConfig,
  client,
  now = new Date(),
}: CollectInput): Promise<ScopeObservationResult> => {
  try {
    const snapshot = await client.getPortfolioSnapshot();
    const observedAt = new Date(snapshot.generatedAt);
    const dataAsOf = new Date(snapshot.dataAsOf);
    const mapped = mapPortfolioSnapshotToHoldings({
      snapshot,
      config: { assetKeyPrefix: sourceConfig.assetKeyPrefix },
    });

    if (mapped.status === "failed") {
      return {
        scopeId: sourceConfig.scopeId,
        observedAt,
        dataAsOf,
        status: "failed",
        error: mapped.error,
        holdings: [],
      };
    }

    return {
      scopeId: sourceConfig.scopeId,
      observedAt,
      dataAsOf,
      status: "success",
      holdings: mapped.holdings,
      ...(mapped.metadata === undefined ? {} : { metadata: mapped.metadata }),
    };
  } catch (error) {
    return {
      scopeId: sourceConfig.scopeId,
      observedAt: now,
      status: "failed",
      error: normalizeUnexpectedError(error),
      holdings: [],
    };
  }
};
