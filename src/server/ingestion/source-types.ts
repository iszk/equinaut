export type SourceObservationErrorCategory = "configuration" | "api" | "valuation" | "network" | "contract";

export type SourceErrorMetadata = {
  endpoint: string;
  httpStatus?: number;
  rawErrorCode?: string;
  bitbankErrorCode?: number;
  normalizedErrorCode: string;
  retryable: boolean;
  category: SourceObservationErrorCategory;
  requestTimeoutMs?: number;
};

export type SourceObservationError = {
  code: string;
  rawErrorCode?: string;
  message: string;
  retryable: boolean;
  category: SourceObservationErrorCategory;
  metadata?: SourceErrorMetadata;
};

export type HoldingSnapshot = {
  assetKey: string;
  assetType: "cash" | "crypto" | "stock" | "fund" | "cfd";
  symbol: string;
  name?: string;
  quantity: string;
  price: string;
  priceCurrency: "JPY";
  fxToJpy: string;
  valueJpy: string;
  raw: Record<string, unknown>;
};

export type ScopeObservationResult =
  | {
      scopeId: string;
      observedAt: Date;
      dataAsOf?: Date;
      status: "success";
      holdings: HoldingSnapshot[];
      metadata?: Record<string, unknown>;
    }
  | {
      scopeId: string;
      observedAt: Date;
      dataAsOf?: Date;
      status: "partial";
      error: SourceObservationError;
      holdings: HoldingSnapshot[];
      metadata?: Record<string, unknown>;
    }
  | {
      scopeId: string;
      observedAt: Date;
      dataAsOf?: Date;
      status: "failed";
      error: SourceObservationError;
      holdings: [];
      metadata?: Record<string, unknown>;
    };
