import { Decimal } from "decimal.js";
import type { BitbankAsset, BitbankTicker, HoldingSnapshot, SourceObservationError } from "./types.js";

type MappingInput = {
  assets: BitbankAsset[];
  tickers: Record<string, BitbankTicker>;
};

type MappingResult =
  | { status: "success"; holdings: HoldingSnapshot[] }
  | { status: "partial"; error: SourceObservationError; holdings: HoldingSnapshot[] };

const symbolFor = (asset: string): string => asset.toUpperCase();

const rawFor = (asset: BitbankAsset) => ({
  source: "bitbank" as const,
  endpoint: "GET /user/assets" as const,
  asset: asset.asset,
  amount_precision: asset.amount_precision,
  onhand_amount: asset.onhand_amount,
  stop_deposit: asset.stop_deposit,
  stop_withdrawal: asset.stop_withdrawal,
});

export const mapBitbankAssetsToHoldings = ({ assets, tickers }: MappingInput): MappingResult => {
  const holdings: HoldingSnapshot[] = [];

  for (const asset of assets) {
    const quantity = new Decimal(asset.onhand_amount);
    if (quantity.isZero()) {
      continue;
    }

    const symbol = symbolFor(asset.asset);
    if (asset.asset === "jpy") {
      holdings.push({
        assetKey: "bitbank:spot_account:cash:JPY",
        assetType: "cash",
        symbol,
        quantity: asset.onhand_amount,
        price: "1",
        priceCurrency: "JPY",
        fxToJpy: "1",
        valueJpy: new Decimal(asset.onhand_amount).toString(),
        raw: rawFor(asset),
      });
      continue;
    }

    const pair = `${asset.asset}_jpy`;
    const ticker = tickers[pair];
    if (ticker === undefined) {
      return {
        status: "partial",
        error: {
          code: "missing_ticker",
          message: `Missing JPY ticker for ${symbol}`,
          retryable: false,
          category: "valuation",
        },
        holdings,
      };
    }

    holdings.push({
      assetKey: `bitbank:spot_account:crypto:${symbol}`,
      assetType: "crypto",
      symbol,
      quantity: asset.onhand_amount,
      price: ticker.last,
      priceCurrency: "JPY",
      fxToJpy: "1",
      valueJpy: new Decimal(asset.onhand_amount).mul(ticker.last).toString(),
      raw: rawFor(asset),
    });
  }

  return { status: "success", holdings };
};
