import { z } from "zod";
import type { BitbankCredentials } from "../../config/secrets.js";
import { env } from "../../config/env.js";
import { createRequestTimeout } from "../../http/request-timeout.js";
import { createBitbankAuthHeaders } from "./signing.js";
import type {
  BitbankAssetsResponse,
  BitbankErrorResponse,
  BitbankHttpEndpoint,
  BitbankHttpErrorMetadata,
  BitbankTickersJpyResponse,
  SourceObservationErrorCategory,
} from "./types.js";

const bitbankAssetSchema = z.object({
  asset: z.string(),
  amount_precision: z.number(),
  onhand_amount: z.string(),
  free_amount: z.string(),
  locked_amount: z.string(),
  withdrawing_amount: z.string(),
  stop_deposit: z.boolean(),
  stop_withdrawal: z.boolean(),
});

const bitbankTickerSchema = z.object({
  sell: z.string().nullable(),
  buy: z.string().nullable(),
  high: z.string(),
  low: z.string(),
  last: z.string(),
  vol: z.string(),
  timestamp: z.number(),
});

const bitbankTickerWithPairSchema = bitbankTickerSchema.extend({
  pair: z.string(),
});

const errorResponseSchema = z.object({
  success: z.literal(0),
  data: z.object({ code: z.number() }),
});

const assetsResponseSchema = z.union([
  z.object({ success: z.literal(1), data: z.object({ assets: z.array(bitbankAssetSchema) }) }),
  errorResponseSchema,
]);

const tickersJpyResponseSchema = z.union([
  z
    .object({ success: z.literal(1), data: z.array(bitbankTickerWithPairSchema) })
    .transform(({ success, data }) => ({
      success,
      data: Object.fromEntries(data.map(({ pair, ...ticker }) => [pair, ticker])),
    })),
  errorResponseSchema,
]);

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type BitbankHttpClient = {
  getUserAssets(): Promise<BitbankAssetsResponse>;
  getTickersJpy(): Promise<BitbankTickersJpyResponse>;
};

type AvailableBitbankCredentials = Extract<BitbankCredentials, { status: "available" }>;

export type BitbankClientInput = {
  credentials: AvailableBitbankCredentials;
  fetchFn?: FetchLike;
  requestTime?: () => string;
  timeWindow?: string;
  requestTimeoutMs?: number;
};

export class BitbankHttpClientError extends Error {
  readonly metadata: BitbankHttpErrorMetadata;
  readonly zodError: z.ZodError | undefined;

  constructor(message: string, metadata: BitbankHttpErrorMetadata, zodError?: z.ZodError) {
    super(message);
    this.name = "BitbankHttpClientError";
    this.metadata = metadata;
    this.zodError = zodError;
  }
}

const isJsonContentType = (contentType: string | null): boolean =>
  contentType !== null && (contentType.includes("application/json") || contentType.includes("+json"));

const metadataFor = ({
  endpoint,
  httpStatus,
  bitbankErrorCode,
  normalizedErrorCode,
  retryable,
  category,
  requestTimeoutMs,
}: {
  endpoint: BitbankHttpEndpoint;
  httpStatus?: number;
  bitbankErrorCode?: number;
  normalizedErrorCode: string;
  retryable: boolean;
  category: SourceObservationErrorCategory;
  requestTimeoutMs?: number;
}): BitbankHttpErrorMetadata => ({
  endpoint,
  ...(httpStatus === undefined ? {} : { httpStatus }),
  ...(bitbankErrorCode === undefined ? {} : { bitbankErrorCode }),
  normalizedErrorCode,
  retryable,
  category,
  ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
});

const normalizeHttpErrorMetadata = (
  endpoint: BitbankHttpEndpoint,
  httpStatus: number,
  bitbankErrorCode?: number,
): BitbankHttpErrorMetadata => {
  if (httpStatus === 429 || bitbankErrorCode === 10009) {
    return metadataFor({
      endpoint,
      httpStatus,
      ...(bitbankErrorCode === undefined ? {} : { bitbankErrorCode }),
      normalizedErrorCode: "rate_limited",
      retryable: true,
      category: "api",
    });
  }

  return metadataFor({
    endpoint,
    httpStatus,
    ...(bitbankErrorCode === undefined ? {} : { bitbankErrorCode }),
    normalizedErrorCode: bitbankErrorCode === undefined ? "bitbank_http_error" : "bitbank_api_error",
    retryable: httpStatus >= 500,
    category: "api",
  });
};

const parseJsonBody = async (response: Response, endpoint: BitbankHttpEndpoint): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    throw new BitbankHttpClientError(
      "bitbank API response was not valid JSON",
      metadataFor({
        endpoint,
        httpStatus: response.status,
        normalizedErrorCode: "bitbank_non_json_response",
        retryable: false,
        category: "contract",
      }),
    );
  }
};

const parseBitbankErrorCode = (body: unknown): number | undefined => {
  const result = errorResponseSchema.safeParse(body);
  if (!result.success) {
    return undefined;
  }

  return result.data.data.code;
};

const withErrorMetadata = (
  response: BitbankErrorResponse,
  endpoint: BitbankHttpEndpoint,
  httpStatus: number,
): BitbankErrorResponse => ({
  ...response,
  metadata: normalizeHttpErrorMetadata(endpoint, httpStatus, response.data.code),
});

const fetchResponse = async (
  fetchFn: FetchLike,
  endpoint: BitbankHttpEndpoint,
  input: string,
  init?: RequestInit,
  requestTimeoutMs = env.INGESTION_HTTP_REQUEST_TIMEOUT_MS,
): Promise<Response> => {
  const requestTimeout = createRequestTimeout(requestTimeoutMs);
  try {
    return await fetchFn(input, { ...init, signal: requestTimeout.signal });
  } catch {
    if (requestTimeout.didTimeout()) {
      throw new BitbankHttpClientError(
        "bitbank request timed out",
        metadataFor({
          endpoint,
          normalizedErrorCode: "bitbank_request_timeout",
          retryable: true,
          category: "network",
          requestTimeoutMs,
        }),
      );
    }

    throw new BitbankHttpClientError(
      "bitbank request failed",
      metadataFor({
        endpoint,
        normalizedErrorCode: "bitbank_network_error",
        retryable: true,
        category: "network",
      }),
    );
  } finally {
    requestTimeout.cleanup();
  }
};

const parseBitbankJsonBody = async (response: Response, endpoint: BitbankHttpEndpoint): Promise<unknown> => {
  if (!response.ok) {
    let body: unknown;
    if (isJsonContentType(response.headers.get("content-type"))) {
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
    }
    const metadata = normalizeHttpErrorMetadata(endpoint, response.status, parseBitbankErrorCode(body));
    throw new BitbankHttpClientError("bitbank API returned an HTTP error", metadata);
  }

  if (!isJsonContentType(response.headers.get("content-type"))) {
    throw new BitbankHttpClientError(
      "bitbank API response was not JSON",
      metadataFor({
        endpoint,
        httpStatus: response.status,
        normalizedErrorCode: "bitbank_non_json_response",
        retryable: false,
        category: "contract",
      }),
    );
  }

  return parseJsonBody(response, endpoint);
};

const parseAssetsResponse = async (
  response: Response,
  endpoint: "GET /user/assets",
): Promise<BitbankAssetsResponse> => {
  const body = await parseBitbankJsonBody(response, endpoint);
  const result = assetsResponseSchema.safeParse(body);
  if (!result.success) {
    throw new BitbankHttpClientError(
      "bitbank API response did not match the expected schema",
      metadataFor({
        endpoint,
        httpStatus: response.status,
        normalizedErrorCode: "bitbank_response_contract_error",
        retryable: false,
        category: "contract",
      }),
      result.error,
    );
  }

  if (result.data.success === 0) {
    return withErrorMetadata(result.data, endpoint, response.status);
  }

  return result.data;
};

const parseTickersJpyResponse = async (
  response: Response,
  endpoint: "GET /tickers_jpy",
): Promise<BitbankTickersJpyResponse> => {
  const body = await parseBitbankJsonBody(response, endpoint);
  const result = tickersJpyResponseSchema.safeParse(body);
  if (!result.success) {
    throw new BitbankHttpClientError(
      "bitbank API response did not match the expected schema",
      metadataFor({
        endpoint,
        httpStatus: response.status,
        normalizedErrorCode: "bitbank_response_contract_error",
        retryable: false,
        category: "contract",
      }),
      result.error,
    );
  }

  if (result.data.success === 0) {
    return withErrorMetadata(result.data, endpoint, response.status);
  }

  return result.data;
};

export const createBitbankHttpClient = ({
  credentials,
  fetchFn = fetch,
  requestTime = () => Date.now().toString(),
  timeWindow = env.BITBANK_ACCESS_TIME_WINDOW_MS.toString(),
  requestTimeoutMs = env.INGESTION_HTTP_REQUEST_TIMEOUT_MS,
}: BitbankClientInput): BitbankHttpClient => ({
  async getUserAssets(): Promise<BitbankAssetsResponse> {
    const requestPathWithQuery = "/v1/user/assets";
    const endpoint: BitbankHttpEndpoint = "GET /user/assets";
    const headers = createBitbankAuthHeaders({
      apiKey: credentials.apiKey,
      apiSecret: credentials.apiSecret,
      requestPathWithQuery,
      requestTime: requestTime(),
      timeWindow,
    });

    const response = await fetchResponse(
      fetchFn,
      endpoint,
      `https://api.bitbank.cc${requestPathWithQuery}`,
      { method: "GET", headers },
      requestTimeoutMs,
    );
    return parseAssetsResponse(response, endpoint);
  },

  async getTickersJpy(): Promise<BitbankTickersJpyResponse> {
    const endpoint: BitbankHttpEndpoint = "GET /tickers_jpy";
    const response = await fetchResponse(
      fetchFn,
      endpoint,
      "https://public.bitbank.cc/tickers_jpy",
      { method: "GET" },
      requestTimeoutMs,
    );
    return parseTickersJpyResponse(response, endpoint);
  },
});
