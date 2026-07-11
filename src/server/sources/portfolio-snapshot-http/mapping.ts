import { Decimal } from "decimal.js";
import type {
  HoldingSnapshot,
  PortfolioSnapshotMappingConfig,
  PortfolioSnapshotMappingResult,
  PortfolioSnapshotV1,
  SourceObservationError,
} from "./types.js";

type SnapshotCashBalance = PortfolioSnapshotV1["cashBalances"][number];
type SnapshotPosition = PortfolioSnapshotV1["positions"][number];

type AssetType = HoldingSnapshot["assetType"];

const supportedAssetTypeFor = (assetClass: SnapshotPosition["assetClass"]): AssetType | undefined => {
  switch (assetClass) {
    case "cash":
      return "cash";
    case "stock":
      return "stock";
    case "etf":
    case "fund":
      return "fund";
    case "cfd":
      return "cfd";
    case "bond":
    case "option":
    case "future":
    case "fx":
      return undefined;
  }
};

const mappingError = (code: string, message: string): SourceObservationError => ({
  code,
  message,
  retryable: false,
  category: "contract",
});

const sourceMetadataWithoutClientKey = (metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined => {
  if (metadata === undefined) {
    return undefined;
  }

  return Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== "clientKey"));
};

const rawCashBalanceFor = (snapshot: PortfolioSnapshotV1, balances: SnapshotCashBalance[]): Record<string, unknown> => ({
  source: snapshot.source.id,
  schemaVersion: snapshot.schemaVersion,
  cashBalances: balances.map((balance) => ({
    sourceAccountId: balance.sourceAccountId,
    currency: balance.currency,
    amount: balance.amount,
    valueJpy: balance.valueJpy,
    ...(balance.fxRateToJpy === undefined ? {} : { fxRateToJpy: balance.fxRateToJpy }),
    ...(balance.sourceBalanceId === undefined ? {} : { sourceBalanceId: balance.sourceBalanceId }),
    ...(balance.sourceMetadata === undefined ? {} : { sourceMetadata: sourceMetadataWithoutClientKey(balance.sourceMetadata) }),
  })),
});

const rawPositionFor = (snapshot: PortfolioSnapshotV1, position: SnapshotPosition): Record<string, unknown> => ({
  source: snapshot.source.id,
  schemaVersion: snapshot.schemaVersion,
  sourceAccountId: position.sourceAccountId,
  sourcePositionId: position.sourcePositionId,
  sourceInstrumentId: position.sourceInstrumentId,
  assetClass: position.assetClass,
  ...(position.side === undefined ? {} : { side: position.side }),
  sourceQuantity: position.quantity,
  ...(position.price === undefined ? {} : { sourcePrice: position.price }),
  ...(position.priceCurrency === undefined ? {} : { sourcePriceCurrency: position.priceCurrency }),
  valueJpy: position.valueJpy,
  ...(position.costBasisJpy === undefined ? {} : { costBasisJpy: position.costBasisJpy }),
  ...(position.unrealizedPnlJpy === undefined ? {} : { unrealizedPnlJpy: position.unrealizedPnlJpy }),
  ...(position.sourceMetadata === undefined ? {} : { sourceMetadata: sourceMetadataWithoutClientKey(position.sourceMetadata) }),
});

const mapCashBalances = ({
  snapshot,
  config,
}: {
  snapshot: PortfolioSnapshotV1;
  config: PortfolioSnapshotMappingConfig;
}): { status: "success"; holdings: HoldingSnapshot[] } | { status: "failed"; error: SourceObservationError } => {
  const grouped = new Map<string, { amount: Decimal; valueJpy: Decimal; balances: SnapshotCashBalance[] }>();

  for (const balance of snapshot.cashBalances) {
    const amount = new Decimal(balance.amount);
    const valueJpy = new Decimal(balance.valueJpy);
    if (amount.isZero() && valueJpy.isZero()) {
      continue;
    }

    const current = grouped.get(balance.currency) ?? { amount: new Decimal(0), valueJpy: new Decimal(0), balances: [] };
    current.amount = current.amount.plus(amount);
    current.valueJpy = current.valueJpy.plus(valueJpy);
    current.balances.push(balance);
    grouped.set(balance.currency, current);
  }

  const holdings: HoldingSnapshot[] = [];
  for (const [currency, aggregate] of grouped.entries()) {
    if (aggregate.amount.isZero()) {
      return {
        status: "failed",
        error: mappingError("cash_zero_amount_nonzero_value", `Cash balance ${currency} has zero amount and non-zero valueJpy`),
      };
    }

    holdings.push({
      assetKey: `${config.assetKeyPrefix}:cash:${currency}`,
      assetType: "cash",
      symbol: currency,
      quantity: aggregate.amount.toString(),
      price: aggregate.valueJpy.div(aggregate.amount).toString(),
      priceCurrency: "JPY",
      fxToJpy: "1",
      valueJpy: aggregate.valueJpy.toString(),
      raw: rawCashBalanceFor(snapshot, aggregate.balances),
    });
  }

  return { status: "success", holdings };
};

const mapPosition = ({
  snapshot,
  config,
  position,
}: {
  snapshot: PortfolioSnapshotV1;
  config: PortfolioSnapshotMappingConfig;
  position: SnapshotPosition;
}): { status: "success"; holding?: HoldingSnapshot } | { status: "failed"; error: SourceObservationError } => {
  const assetType = supportedAssetTypeFor(position.assetClass);
  if (assetType === undefined || assetType === "cash") {
    return {
      status: "failed",
      error: mappingError("unsupported_asset_class", `Unsupported portfolio-snapshot asset class: ${position.assetClass}`),
    };
  }

  const quantity = new Decimal(position.quantity);
  const valueJpy = new Decimal(position.valueJpy);
  if (quantity.isZero() && valueJpy.isZero()) {
    return { status: "success" };
  }

  if (quantity.isZero()) {
    return {
      status: "failed",
      error: mappingError("zero_quantity_nonzero_value", `Position ${position.sourcePositionId} has zero quantity and non-zero valueJpy`),
    };
  }

  if (assetType !== "cfd" && (quantity.isNegative() || position.side === "short")) {
    return {
      status: "failed",
      error: mappingError("unsupported_non_cfd_short", `Non-CFD short position is not supported: ${position.sourcePositionId}`),
    };
  }

  const common = {
    assetKey: `${config.assetKeyPrefix}:${assetType}:${position.sourcePositionId}`,
    assetType,
    symbol: position.symbol,
    ...(position.name === undefined ? {} : { name: position.name }),
    priceCurrency: "JPY" as const,
    fxToJpy: "1",
    valueJpy: position.valueJpy,
    raw: rawPositionFor(snapshot, position),
  };

  if (assetType === "cfd") {
    return {
      status: "success",
      holding: {
        ...common,
        quantity: position.valueJpy,
        price: "1",
      },
    };
  }

  return {
    status: "success",
    holding: {
      ...common,
      quantity: position.quantity,
      price: valueJpy.div(quantity).toString(),
    },
  };
};

export const mapPortfolioSnapshotToHoldings = ({
  snapshot,
  config,
}: {
  snapshot: PortfolioSnapshotV1;
  config: PortfolioSnapshotMappingConfig;
}): PortfolioSnapshotMappingResult => {
  const cashResult = mapCashBalances({ snapshot, config });
  if (cashResult.status === "failed") {
    return { status: "failed", error: cashResult.error, holdings: [] };
  }

  const holdings = cashResult.holdings;

  for (const position of snapshot.positions) {
    const result = mapPosition({ snapshot, config, position });
    if (result.status === "failed") {
      return { status: "failed", error: result.error, holdings: [] };
    }

    if (result.holding !== undefined) {
      holdings.push(result.holding);
    }
  }

  return { status: "success", holdings };
};
