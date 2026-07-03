import type {
  HoldingSnapshot,
  SourceErrorMetadata,
  SourceObservationError,
  SourceObservationErrorCategory,
} from "../../ingestion/source-types.js";

export type BitflyerBalance = {
  currency_code: string;
  amount: string;
  available: string;
};

export type BitflyerCollateral = {
  collateral: string;
  open_position_pnl: string;
  require_collateral: string;
  keep_rate: string;
  margin_call_amount?: string | null | undefined;
  margin_call_due_date?: string | null | undefined;
};

export type BitflyerCollateralAccount = {
  currency_code: string;
  amount: string;
};

export type BitflyerPosition = {
  product_code: string;
  side: "BUY" | "SELL";
  price: string;
  size: string;
  commission: string;
  swap_point_accumulate: string;
  require_collateral: string;
  open_date: string;
  leverage: string;
  pnl: string;
  sfd?: string | undefined;
  funding_fees?: string | undefined;
};

export type BitflyerTicker = {
  product_code: string;
  timestamp: string;
  ltp: string;
};

export type BitflyerHttpEndpoint =
  | "GET /v1/me/getbalance"
  | "GET /v1/me/getcollateral"
  | "GET /v1/me/getcollateralaccounts"
  | "GET /v1/me/getpositions"
  | "GET /v1/ticker";

export type BitflyerHttpErrorMetadata = SourceErrorMetadata & {
  endpoint: BitflyerHttpEndpoint;
};

export type {
  HoldingSnapshot,
  SourceObservationError,
  SourceObservationErrorCategory,
};
