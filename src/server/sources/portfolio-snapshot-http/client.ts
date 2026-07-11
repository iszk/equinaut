import { z } from "zod";
import { portfolioSnapshotV1Schema } from "../../../contracts/portfolio-snapshot/v1.js";
import type { PortfolioSnapshotV1 } from "../../../contracts/portfolio-snapshot/v1.js";
import type {
  PortfolioSnapshotHttpClient,
  PortfolioSnapshotHttpEndpoint,
  PortfolioSnapshotHttpErrorMetadata,
  SourceObservationErrorCategory,
} from "./types.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type PortfolioSnapshotHttpClientInput = {
  url: string;
  bearerToken: string;
  fetchFn?: FetchLike;
};

export class PortfolioSnapshotHttpClientError extends Error {
  readonly metadata: PortfolioSnapshotHttpErrorMetadata;
  readonly zodError: z.ZodError | undefined;

  constructor(message: string, metadata: PortfolioSnapshotHttpErrorMetadata, zodError?: z.ZodError) {
    super(message);
    this.name = "PortfolioSnapshotHttpClientError";
    this.metadata = metadata;
    this.zodError = zodError;
  }
}

const endpoint: PortfolioSnapshotHttpEndpoint = "GET portfolio snapshot";

const isJsonContentType = (contentType: string | null): boolean => {
  if (contentType === null) {
    return false;
  }

  const normalized = contentType.toLowerCase();
  return normalized.includes("application/json") || normalized.includes("+json");
};

const metadataFor = ({
  httpStatus,
  rawErrorCode,
  normalizedErrorCode,
  retryable,
  category,
}: {
  httpStatus?: number;
  rawErrorCode?: string;
  normalizedErrorCode: string;
  retryable: boolean;
  category: SourceObservationErrorCategory;
}): PortfolioSnapshotHttpErrorMetadata => ({
  endpoint,
  ...(httpStatus === undefined ? {} : { httpStatus }),
  ...(rawErrorCode === undefined ? {} : { rawErrorCode }),
  normalizedErrorCode,
  retryable,
  category,
});

const normalizeHttpErrorMetadata = (httpStatus: number): PortfolioSnapshotHttpErrorMetadata => {
  if (httpStatus === 429) {
    return metadataFor({
      httpStatus,
      normalizedErrorCode: "rate_limited",
      retryable: true,
      category: "api",
    });
  }

  return metadataFor({
    httpStatus,
    normalizedErrorCode: "portfolio_snapshot_http_error",
    retryable: httpStatus >= 500,
    category: "api",
  });
};

const fetchResponse = async (fetchFn: FetchLike, input: string, init: RequestInit): Promise<Response> => {
  try {
    return await fetchFn(input, init);
  } catch {
    throw new PortfolioSnapshotHttpClientError(
      "portfolio snapshot request failed",
      metadataFor({
        normalizedErrorCode: "portfolio_snapshot_network_error",
        retryable: true,
        category: "network",
      }),
    );
  }
};

const parseJsonBody = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    throw new PortfolioSnapshotHttpClientError(
      "portfolio snapshot API response was not valid JSON",
      metadataFor({
        httpStatus: response.status,
        normalizedErrorCode: "portfolio_snapshot_non_json_response",
        retryable: false,
        category: "contract",
      }),
    );
  }
};

const parsePortfolioSnapshotJsonBody = async (response: Response): Promise<unknown> => {
  if (!response.ok) {
    throw new PortfolioSnapshotHttpClientError(
      "portfolio snapshot API returned an HTTP error",
      normalizeHttpErrorMetadata(response.status),
    );
  }

  if (!isJsonContentType(response.headers.get("content-type"))) {
    throw new PortfolioSnapshotHttpClientError(
      "portfolio snapshot API response was not JSON",
      metadataFor({
        httpStatus: response.status,
        normalizedErrorCode: "portfolio_snapshot_non_json_response",
        retryable: false,
        category: "contract",
      }),
    );
  }

  return parseJsonBody(response);
};

const parsePortfolioSnapshotResponse = async (response: Response): Promise<PortfolioSnapshotV1> => {
  const body = await parsePortfolioSnapshotJsonBody(response);
  const result = portfolioSnapshotV1Schema.safeParse(body);
  if (!result.success) {
    throw new PortfolioSnapshotHttpClientError(
      "portfolio snapshot API response did not match the expected schema",
      metadataFor({
        httpStatus: response.status,
        normalizedErrorCode: "portfolio_snapshot_response_contract_error",
        retryable: false,
        category: "contract",
      }),
      result.error,
    );
  }

  return result.data;
};

export const createPortfolioSnapshotHttpClient = ({
  url,
  bearerToken,
  fetchFn = fetch,
}: PortfolioSnapshotHttpClientInput): PortfolioSnapshotHttpClient => ({
  async getPortfolioSnapshot(): Promise<PortfolioSnapshotV1> {
    const response = await fetchResponse(fetchFn, url, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${bearerToken}`,
      },
    });

    return parsePortfolioSnapshotResponse(response);
  },
});
