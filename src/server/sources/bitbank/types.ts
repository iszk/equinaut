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
  sell: string;
  buy: string;
  high: string;
  low: string;
  last: string;
  vol: string;
  timestamp: number;
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

export type HoldingSnapshot = {
  assetKey: string;
  assetType: "cash" | "crypto" | "stock" | "fund";
  symbol: string;
  name?: string;
  quantity: string;
  price: string;
  priceCurrency: "JPY";
  fxToJpy: string;
  valueJpy: string;
  raw: SanitizedBitbankAssetRaw;
};

export type SourceObservationError = {
  code: string;
  rawErrorCode?: string;
  message: string;
  retryable: boolean;
  category: "configuration" | "api" | "valuation" | "network" | "contract";
};
