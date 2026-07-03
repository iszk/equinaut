import type {
  HoldingSnapshot,
  SourceErrorMetadata,
  SourceObservationError,
  SourceObservationErrorCategory,
} from "../../ingestion/source-types.js";

export type BitbankAsset = {
  asset: string;
  amount_precision: number;
  onhand_amount: string;
  free_amount: string;
  locked_amount: string;
  withdrawing_amount: string;
  stop_deposit: boolean;
  stop_withdrawal: boolean;
};

export type BitbankTicker = {
  sell: string | null;
  buy: string | null;
  high: string;
  low: string;
  last: string;
  vol: string;
  timestamp: number;
};

export type BitbankHttpEndpoint = "GET /user/assets" | "GET /tickers_jpy";

export type BitbankHttpErrorMetadata = SourceErrorMetadata & {
  endpoint: BitbankHttpEndpoint;
  bitbankErrorCode?: number;
};

export type BitbankSuccessResponse<T> = {
  success: 1;
  data: T;
};

export type BitbankErrorResponse = {
  success: 0;
  data: {
    code: number;
  };
  metadata?: BitbankHttpErrorMetadata;
};

export type BitbankAssetsResponse =
  | BitbankSuccessResponse<{ assets: BitbankAsset[] }>
  | BitbankErrorResponse;

export type BitbankTickersJpyResponse =
  | BitbankSuccessResponse<Record<string, BitbankTicker>>
  | BitbankErrorResponse;

export type SanitizedBitbankAssetRaw = {
  source: "bitbank";
  endpoint: "GET /user/assets";
  asset: string;
  amount_precision: number;
  onhand_amount: string;
  stop_deposit: boolean;
  stop_withdrawal: boolean;
};

export type { HoldingSnapshot, SourceObservationError, SourceObservationErrorCategory };
