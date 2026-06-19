import { describe, expect, it } from "vitest";
import { mapBitbankAssetsToHoldings } from "./mapping.js";
import type { BitbankAsset, BitbankTicker } from "./types.js";

const ticker = (last: string): BitbankTicker => ({
  sell: "0",
  buy: "0",
  high: "0",
  low: "0",
  last,
  vol: "0",
  timestamp: 1700000000000,
});

const asset = (overrides: Partial<BitbankAsset>): BitbankAsset => ({
  asset: "btc",
  amount_precision: 8,
  onhand_amount: "0.5",
  free_amount: "0.5",
  locked_amount: "0",
  withdrawing_amount: "0",
  stop_deposit: false,
  stop_withdrawal: false,
  ...overrides,
});

describe("mapBitbankAssetsToHoldings", () => {
  it("maps JPY to cash with price 1", () => {
    const result = mapBitbankAssetsToHoldings({ assets: [asset({ asset: "jpy", onhand_amount: "1234" })], tickers: {} });

    expect(result).toEqual({
      status: "success",
      holdings: [
        {
          assetKey: "bitbank:spot_account:cash:JPY",
          assetType: "cash",
          symbol: "JPY",
          quantity: "1234",
          price: "1",
          priceCurrency: "JPY",
          fxToJpy: "1",
          valueJpy: "1234",
          raw: {
            source: "bitbank",
            endpoint: "GET /user/assets",
            asset: "jpy",
            amount_precision: 8,
            onhand_amount: "1234",
            stop_deposit: false,
            stop_withdrawal: false,
          },
        },
      ],
    });
  });

  it("maps crypto to JPY valuation using ticker last", () => {
    const result = mapBitbankAssetsToHoldings({ assets: [asset({ asset: "btc", onhand_amount: "0.12345678" })], tickers: { btc_jpy: ticker("10000000") } });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.holdings[0]?.assetType).toBe("crypto");
      expect(result.holdings[0]?.valueJpy).toBe("1234567.8");
      expect(result.holdings[0]?.raw).not.toHaveProperty("free_amount");
      expect(result.holdings[0]?.raw).not.toHaveProperty("locked_amount");
    }
  });

  it("skips zero quantity assets without requiring tickers", () => {
    const result = mapBitbankAssetsToHoldings({
      assets: [asset({ asset: "jpy", onhand_amount: "0.0000" }), asset({ asset: "btc", onhand_amount: "0.00000000" })],
      tickers: {},
    });

    expect(result).toEqual({ status: "success", holdings: [] });
  });

  it("returns partial when a JPY ticker is missing", () => {
    const result = mapBitbankAssetsToHoldings({ assets: [asset({ asset: "eth" })], tickers: {} });

    expect(result).toEqual({
      status: "partial",
      error: {
        code: "missing_ticker",
        message: "Missing JPY ticker for ETH",
        retryable: false,
        category: "valuation",
      },
      holdings: [],
    });
  });
});
