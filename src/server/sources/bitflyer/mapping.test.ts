import { describe, expect, it } from "vitest";
import { mapBitflyerCfdToHoldings, mapBitflyerSpotBalancesToHoldings } from "./mapping.js";
import type { BitflyerBalance, BitflyerCollateral, BitflyerCollateralAccount, BitflyerTicker } from "./types.js";

const ticker = (productCode: string, ltp: string): BitflyerTicker => ({
  product_code: productCode,
  timestamp: "2026-07-02T00:00:00.000",
  ltp,
});

const balance = (overrides: Partial<BitflyerBalance>): BitflyerBalance => ({
  currency_code: "BTC",
  amount: "0.1",
  available: "0.1",
  ...overrides,
});

const collateralAccount = (overrides: Partial<BitflyerCollateralAccount>): BitflyerCollateralAccount => ({
  currency_code: "BTC",
  amount: "0.001",
  ...overrides,
});

const collateral = (overrides: Partial<BitflyerCollateral> = {}): BitflyerCollateral => ({
  collateral: "30012",
  open_position_pnl: "-10",
  require_collateral: "1000",
  keep_rate: "3",
  ...overrides,
});

describe("mapBitflyerSpotBalancesToHoldings", () => {
  it("maps spot JPY and BTC balances to holdings", () => {
    const result = mapBitflyerSpotBalancesToHoldings({
      balances: [balance({ currency_code: "JPY", amount: "20000", available: "15000" }), balance({})],
      tickers: { BTC_JPY: ticker("BTC_JPY", "10000000") },
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.holdings).toMatchObject([
        {
          assetKey: "bitflyer:spot_account:cash:JPY",
          assetType: "cash",
          symbol: "JPY",
          valueJpy: "20000",
        },
        {
          assetKey: "bitflyer:spot_account:crypto:BTC",
          assetType: "crypto",
          symbol: "BTC",
          price: "10000000",
          valueJpy: "1000000",
        },
      ]);
    }
  });

  it("skips zero balances without requiring tickers", () => {
    const result = mapBitflyerSpotBalancesToHoldings({
      balances: [balance({ currency_code: "BTC", amount: "0", available: "0" })],
      tickers: {},
    });

    expect(result).toEqual({ status: "success", holdings: [] });
  });

  it("returns partial when a JPY ticker is missing", () => {
    const result = mapBitflyerSpotBalancesToHoldings({ balances: [balance({ currency_code: "ETH" })], tickers: {} });

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

describe("mapBitflyerCfdToHoldings", () => {
  it("maps collateral accounts and open position PnL to holdings", () => {
    const result = mapBitflyerCfdToHoldings({
      collateral: collateral(),
      collateralAccounts: [collateralAccount({ currency_code: "JPY", amount: "20000" }), collateralAccount({})],
      positions: [],
      tickers: { BTC_JPY: ticker("BTC_JPY", "10000000") },
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.holdings).toMatchObject([
        {
          assetKey: "bitflyer:cfd_account:cash:JPY",
          valueJpy: "20000",
        },
        {
          assetKey: "bitflyer:cfd_account:crypto:BTC",
          valueJpy: "10000",
        },
        {
          assetKey: "bitflyer:cfd_account:cfd:JPY:unrealized_pnl",
          assetType: "cfd",
          name: "CFD評価損益",
          quantity: "-10",
          valueJpy: "-10",
        },
      ]);
      expect(result.metadata).toEqual({
        collateral_check: {
          collateral_jpy: "30012",
          collateral_accounts_value_jpy: "30000",
          collateral_difference_jpy: "12",
        },
        positions: [],
      });
    }
  });

  it("does not save a zero open position PnL holding", () => {
    const result = mapBitflyerCfdToHoldings({
      collateral: collateral({ open_position_pnl: "0" }),
      collateralAccounts: [collateralAccount({ currency_code: "JPY", amount: "20000" })],
      positions: [],
      tickers: {},
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.holdings.map((holding) => holding.assetKey)).toEqual(["bitflyer:cfd_account:cash:JPY"]);
    }
  });
});
