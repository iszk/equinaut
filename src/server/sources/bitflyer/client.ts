import { z } from "zod";
import type { BitflyerCredentials } from "../../config/secrets.js";
import { createBitflyerAuthHeaders } from "./signing.js";
import type { BitflyerAuthHeaders } from "./signing.js";
import type {
  BitflyerBalance,
  BitflyerCollateral,
  BitflyerCollateralAccount,
  BitflyerHttpEndpoint,
  BitflyerHttpErrorMetadata,
  BitflyerPosition,
  BitflyerTicker,
  SourceObservationErrorCategory,
} from "./types.js";

const numberStringSchema = z.number().transform((value) => value.toString());

const balanceSchema = z.object({
  currency_code: z.string(),
  amount: numberStringSchema,
  available: numberStringSchema,
});

const collateralSchema = z.object({
  collateral: numberStringSchema,
  open_position_pnl: numberStringSchema,
  require_collateral: numberStringSchema,
  keep_rate: numberStringSchema,
  margin_call_amount: numberStringSchema.optional(),
  margin_call_due_date: z.string().optional(),
});

const collateralAccountSchema = z.object({
  currency_code: z.string(),
  amount: numberStringSchema,
});

const positionSchema = z.object({
  product_code: z.string(),
  side: z.enum(["BUY", "SELL"]),
  price: numberStringSchema,
  size: numberStringSchema,
  commission: numberStringSchema,
  swap_point_accumulate: numberStringSchema,
  require_collateral: numberStringSchema,
  open_date: z.string(),
  leverage: numberStringSchema,
  pnl: numberStringSchema,
  sfd: numberStringSchema.optional(),
  funding_fees: numberStringSchema.optional(),
});

const tickerSchema = z.object({
  product_code: z.string(),
  timestamp: z.string(),
  ltp: numberStringSchema,
});

const bitflyerErrorResponseSchema = z.object({
  status: z.number(),
  error_message: z.string().optional(),
});

const balancesResponseSchema = z.array(balanceSchema);
const collateralAccountsResponseSchema = z.array(collateralAccountSchema);
const positionsResponseSchema = z.array(positionSchema);

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type BitflyerHttpClient = {
  getBalance(): Promise<BitflyerBalance[]>;
  getCollateral(): Promise<BitflyerCollateral>;
  getCollateralAccounts(): Promise<BitflyerCollateralAccount[]>;
  getPositions(productCode: "FX_BTC_JPY"): Promise<BitflyerPosition[]>;
  getTicker(productCode: string): Promise<BitflyerTicker>;
};

type AvailableBitflyerCredentials = Extract<BitflyerCredentials, { status: "available" }>;

export type BitflyerClientInput = {
  credentials: AvailableBitflyerCredentials;
  fetchFn?: FetchLike;
  timestamp?: () => string;
};

export class BitflyerHttpClientError extends Error {
  readonly metadata: BitflyerHttpErrorMetadata;
  readonly zodError: z.ZodError | undefined;

  constructor(message: string, metadata: BitflyerHttpErrorMetadata, zodError?: z.ZodError) {
    super(message);
    this.name = "BitflyerHttpClientError";
    this.metadata = metadata;
    this.zodError = zodError;
  }
}

const isJsonContentType = (contentType: string | null): boolean =>
  contentType !== null && (contentType.includes("application/json") || contentType.includes("+json"));

const metadataFor = ({
  endpoint,
  httpStatus,
  rawErrorCode,
  normalizedErrorCode,
  retryable,
  category,
}: {
  endpoint: BitflyerHttpEndpoint;
  httpStatus?: number;
  rawErrorCode?: string;
  normalizedErrorCode: string;
  retryable: boolean;
  category: SourceObservationErrorCategory;
}): BitflyerHttpErrorMetadata => ({
  endpoint,
  ...(httpStatus === undefined ? {} : { httpStatus }),
  ...(rawErrorCode === undefined ? {} : { rawErrorCode }),
  normalizedErrorCode,
  retryable,
  category,
});

const parseBitflyerErrorStatus = (body: unknown): string | undefined => {
  const result = bitflyerErrorResponseSchema.safeParse(body);
  if (!result.success) {
    return undefined;
  }

  return result.data.status.toString();
};

const normalizeHttpErrorMetadata = (
  endpoint: BitflyerHttpEndpoint,
  httpStatus: number,
  rawErrorCode?: string,
): BitflyerHttpErrorMetadata => {
  if (httpStatus === 429) {
    return metadataFor({
      endpoint,
      httpStatus,
      ...(rawErrorCode === undefined ? {} : { rawErrorCode }),
      normalizedErrorCode: "rate_limited",
      retryable: true,
      category: "api",
    });
  }

  return metadataFor({
    endpoint,
    httpStatus,
    ...(rawErrorCode === undefined ? {} : { rawErrorCode }),
    normalizedErrorCode: rawErrorCode === undefined ? "bitflyer_http_error" : "bitflyer_api_error",
    retryable: httpStatus >= 500,
    category: "api",
  });
};

const fetchResponse = async (
  fetchFn: FetchLike,
  endpoint: BitflyerHttpEndpoint,
  input: string,
  init?: RequestInit,
): Promise<Response> => {
  try {
    return await fetchFn(input, init);
  } catch {
    throw new BitflyerHttpClientError(
      "bitflyer request failed",
      metadataFor({
        endpoint,
        normalizedErrorCode: "bitflyer_network_error",
        retryable: true,
        category: "network",
      }),
    );
  }
};

const parseJsonBody = async (response: Response, endpoint: BitflyerHttpEndpoint): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    throw new BitflyerHttpClientError(
      "bitflyer API response was not valid JSON",
      metadataFor({
        endpoint,
        httpStatus: response.status,
        normalizedErrorCode: "bitflyer_non_json_response",
        retryable: false,
        category: "contract",
      }),
    );
  }
};

const parseBitflyerJsonBody = async (response: Response, endpoint: BitflyerHttpEndpoint): Promise<unknown> => {
  if (!response.ok) {
    let body: unknown;
    if (isJsonContentType(response.headers.get("content-type"))) {
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
    }
    throw new BitflyerHttpClientError(
      "bitflyer API returned an HTTP error",
      normalizeHttpErrorMetadata(endpoint, response.status, parseBitflyerErrorStatus(body)),
    );
  }

  if (!isJsonContentType(response.headers.get("content-type"))) {
    throw new BitflyerHttpClientError(
      "bitflyer API response was not JSON",
      metadataFor({
        endpoint,
        httpStatus: response.status,
        normalizedErrorCode: "bitflyer_non_json_response",
        retryable: false,
        category: "contract",
      }),
    );
  }

  return parseJsonBody(response, endpoint);
};

const parseResponse = async <T>(
  response: Response,
  endpoint: BitflyerHttpEndpoint,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<T> => {
  const body = await parseBitflyerJsonBody(response, endpoint);
  const errorResult = bitflyerErrorResponseSchema.safeParse(body);
  if (errorResult.success) {
    throw new BitflyerHttpClientError(
      "bitflyer API returned an error",
      metadataFor({
        endpoint,
        httpStatus: response.status,
        rawErrorCode: errorResult.data.status.toString(),
        normalizedErrorCode: "bitflyer_api_error",
        retryable: false,
        category: "api",
      }),
    );
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BitflyerHttpClientError(
      "bitflyer API response did not match the expected schema",
      metadataFor({
        endpoint,
        httpStatus: response.status,
        normalizedErrorCode: "bitflyer_response_contract_error",
        retryable: false,
        category: "contract",
      }),
      result.error,
    );
  }

  return result.data;
};

const authHeadersFor = ({
  credentials,
  method,
  requestPathWithQuery,
  timestamp,
}: {
  credentials: AvailableBitflyerCredentials;
  method: "GET";
  requestPathWithQuery: string;
  timestamp: string;
}): BitflyerAuthHeaders =>
  createBitflyerAuthHeaders({
    apiKey: credentials.apiKey,
    apiSecret: credentials.apiSecret,
    method,
    requestPathWithQuery,
    timestamp,
  });

export const createBitflyerHttpClient = ({
  credentials,
  fetchFn = fetch,
  timestamp = () => (Date.now() / 1000).toString(),
}: BitflyerClientInput): BitflyerHttpClient => ({
  async getBalance(): Promise<BitflyerBalance[]> {
    const requestPathWithQuery = "/v1/me/getbalance";
    const endpoint: BitflyerHttpEndpoint = "GET /v1/me/getbalance";
    const response = await fetchResponse(fetchFn, endpoint, `https://api.bitflyer.com${requestPathWithQuery}`, {
      method: "GET",
      headers: authHeadersFor({ credentials, method: "GET", requestPathWithQuery, timestamp: timestamp() }),
    });
    return parseResponse(response, endpoint, balancesResponseSchema);
  },

  async getCollateral(): Promise<BitflyerCollateral> {
    const requestPathWithQuery = "/v1/me/getcollateral";
    const endpoint: BitflyerHttpEndpoint = "GET /v1/me/getcollateral";
    const response = await fetchResponse(fetchFn, endpoint, `https://api.bitflyer.com${requestPathWithQuery}`, {
      method: "GET",
      headers: authHeadersFor({ credentials, method: "GET", requestPathWithQuery, timestamp: timestamp() }),
    });
    return parseResponse(response, endpoint, collateralSchema);
  },

  async getCollateralAccounts(): Promise<BitflyerCollateralAccount[]> {
    const requestPathWithQuery = "/v1/me/getcollateralaccounts";
    const endpoint: BitflyerHttpEndpoint = "GET /v1/me/getcollateralaccounts";
    const response = await fetchResponse(fetchFn, endpoint, `https://api.bitflyer.com${requestPathWithQuery}`, {
      method: "GET",
      headers: authHeadersFor({ credentials, method: "GET", requestPathWithQuery, timestamp: timestamp() }),
    });
    return parseResponse(response, endpoint, collateralAccountsResponseSchema);
  },

  async getPositions(productCode: "FX_BTC_JPY"): Promise<BitflyerPosition[]> {
    const requestPathWithQuery = `/v1/me/getpositions?product_code=${encodeURIComponent(productCode)}`;
    const endpoint: BitflyerHttpEndpoint = "GET /v1/me/getpositions";
    const response = await fetchResponse(fetchFn, endpoint, `https://api.bitflyer.com${requestPathWithQuery}`, {
      method: "GET",
      headers: authHeadersFor({ credentials, method: "GET", requestPathWithQuery, timestamp: timestamp() }),
    });
    return parseResponse(response, endpoint, positionsResponseSchema);
  },

  async getTicker(productCode: string): Promise<BitflyerTicker> {
    const requestPathWithQuery = `/v1/ticker?product_code=${encodeURIComponent(productCode)}`;
    const endpoint: BitflyerHttpEndpoint = "GET /v1/ticker";
    const response = await fetchResponse(fetchFn, endpoint, `https://api.bitflyer.com${requestPathWithQuery}`, {
      method: "GET",
    });
    return parseResponse(response, endpoint, tickerSchema);
  },
});
