import { z } from "zod";
import type { BitbankCredentials } from "../../config/secrets.js";
import { env } from "../../config/env.js";
import { createBitbankAuthHeaders } from "./signing.js";
import type { BitbankAssetsResponse, BitbankTickersJpyResponse } from "./types.js";

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
};

const parseJson = async (response: Response): Promise<unknown> => response.json();

export const createBitbankHttpClient = ({
  credentials,
  fetchFn = fetch,
  requestTime = () => Date.now().toString(),
  timeWindow = env.BITBANK_ACCESS_TIME_WINDOW_MS.toString(),
}: BitbankClientInput): BitbankHttpClient => ({
  async getUserAssets(): Promise<BitbankAssetsResponse> {
    const requestPathWithQuery = "/v1/user/assets";
    const headers = createBitbankAuthHeaders({
      apiKey: credentials.apiKey,
      apiSecret: credentials.apiSecret,
      requestPathWithQuery,
      requestTime: requestTime(),
      timeWindow,
    });

    const response = await fetchFn(`https://api.bitbank.cc${requestPathWithQuery}`, { method: "GET", headers });
    return assetsResponseSchema.parse(await parseJson(response));
  },

  async getTickersJpy(): Promise<BitbankTickersJpyResponse> {
    const response = await fetchFn("https://public.bitbank.cc/tickers_jpy", { method: "GET" });
    return tickersJpyResponseSchema.parse(await parseJson(response));
  },
});
