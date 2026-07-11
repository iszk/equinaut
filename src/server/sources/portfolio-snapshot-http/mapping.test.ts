import { describe, expect, it } from "vitest";
import { portfolioSnapshotV1Example } from "../../../contracts/portfolio-snapshot/v1.js";
import type { PortfolioSnapshotV1 } from "../../../contracts/portfolio-snapshot/v1.js";
import { mapPortfolioSnapshotToHoldings } from "./mapping.js";

const config = { assetKeyPrefix: "saxo:portfolio" };

const baseSnapshot = (): PortfolioSnapshotV1 => ({
  ...portfolioSnapshotV1Example,
  accounts: [
    {
      sourceAccountId: "account-1",
      name: "Saxo",
      baseCurrency: "JPY",
      sourceMetadata: { clientKey: "do-not-store" },
    },
  ],
  cashBalances: [],
  positions: [],
});

describe("mapPortfolioSnapshotToHoldings", () => {
  it("maps complete portfolio-snapshot holdings using stable Saxo portfolio asset keys", () => {
    const snapshot: PortfolioSnapshotV1 = {
      ...baseSnapshot(),
      cashBalances: [
        {
          sourceAccountId: "account-1",
          currency: "USD",
          amount: "10",
          valueJpy: "1600",
          fxRateToJpy: "160",
          sourceBalanceId: "balance-1",
          sourceMetadata: { clientKey: "do-not-store", reportedCurrency: "USD" },
        },
        {
          sourceAccountId: "account-2",
          currency: "USD",
          amount: "5",
          valueJpy: "800",
          fxRateToJpy: "160",
          sourceBalanceId: "balance-2",
        },
      ],
      positions: [
        {
          sourceAccountId: "account-1",
          sourcePositionId: "position-stock",
          sourceInstrumentId: "Stock:7203",
          assetClass: "stock",
          symbol: "7203.T",
          name: "Toyota",
          quantity: "2",
          side: "long",
          price: "3300",
          priceCurrency: "JPY",
          valueJpy: "6600",
          sourceMetadata: { netPositionId: "net-stock", clientKey: "do-not-store" },
        },
        {
          sourceAccountId: "account-1",
          sourcePositionId: "position-etf",
          sourceInstrumentId: "Etf:VOO",
          assetClass: "etf",
          symbol: "VOO",
          quantity: "3",
          side: "long",
          price: "500",
          priceCurrency: "USD",
          valueJpy: "240000",
        },
        {
          sourceAccountId: "account-1",
          sourcePositionId: "position-cfd",
          sourceInstrumentId: "CfdOnStock:MRVL",
          assetClass: "cfd",
          symbol: "MRVL:xnas",
          quantity: "6",
          side: "long",
          price: "231.71",
          priceCurrency: "USD",
          valueJpy: "-67698",
          unrealizedPnlJpy: "-67698",
          sourceMetadata: {
            netPositionId: "position-cfd",
            valuationBasis: "equity_contribution",
            notionalValueJpy: "225807.41946",
          },
        },
      ],
    };

    const result = mapPortfolioSnapshotToHoldings({ snapshot, config });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.holdings.map((holding) => holding.assetKey)).toEqual([
        "saxo:portfolio:cash:USD",
        "saxo:portfolio:stock:position-stock",
        "saxo:portfolio:fund:position-etf",
        "saxo:portfolio:cfd:position-cfd",
      ]);
      expect(result.holdings[0]).toMatchObject({
        symbol: "USD",
        quantity: "15",
        price: "160",
        valueJpy: "2400",
      });
      expect(result.holdings[1]).toMatchObject({
        quantity: "2",
        price: "3300",
        valueJpy: "6600",
      });
      expect(result.holdings[2]).toMatchObject({
        assetType: "fund",
        quantity: "3",
        price: "80000",
        valueJpy: "240000",
      });
      expect(result.holdings[3]).toMatchObject({
        assetType: "cfd",
        quantity: "-67698",
        price: "1",
        valueJpy: "-67698",
      });
      expect(JSON.stringify(result.holdings)).not.toContain("do-not-store");
      expect(result.holdings[1]?.raw).toMatchObject({
        sourcePositionId: "position-stock",
        sourceInstrumentId: "Stock:7203",
        sourceMetadata: { netPositionId: "net-stock" },
      });
    }
  });

  it("fails the whole snapshot when an asset class cannot be represented in holdings", () => {
    const snapshot: PortfolioSnapshotV1 = {
      ...baseSnapshot(),
      positions: [
        {
          sourceAccountId: "account-1",
          sourcePositionId: "bond-1",
          sourceInstrumentId: "Bond:1",
          assetClass: "bond",
          symbol: "BOND",
          quantity: "1",
          valueJpy: "1000",
        },
      ],
    };

    expect(mapPortfolioSnapshotToHoldings({ snapshot, config })).toEqual({
      status: "failed",
      error: {
        code: "unsupported_asset_class",
        message: "Unsupported portfolio-snapshot asset class: bond",
        retryable: false,
        category: "contract",
      },
      holdings: [],
    });
  });

  it("fails cash balances that cannot be represented as quantity and JPY price", () => {
    const snapshot: PortfolioSnapshotV1 = {
      ...baseSnapshot(),
      cashBalances: [
        {
          sourceAccountId: "account-1",
          currency: "JPY",
          amount: "0",
          valueJpy: "100",
        },
      ],
    };

    expect(mapPortfolioSnapshotToHoldings({ snapshot, config })).toEqual({
      status: "failed",
      error: {
        code: "cash_zero_amount_nonzero_value",
        message: "Cash balance JPY has zero amount and non-zero valueJpy",
        retryable: false,
        category: "contract",
      },
      holdings: [],
    });
  });

  it("fails non-CFD short positions until their representation is explicitly decided", () => {
    const snapshot: PortfolioSnapshotV1 = {
      ...baseSnapshot(),
      positions: [
        {
          sourceAccountId: "account-1",
          sourcePositionId: "short-stock",
          sourceInstrumentId: "Stock:1",
          assetClass: "stock",
          symbol: "SHORT",
          quantity: "-1",
          side: "short",
          valueJpy: "-1000",
        },
      ],
    };

    const result = mapPortfolioSnapshotToHoldings({ snapshot, config });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.code).toBe("unsupported_non_cfd_short");
    }
  });
});
