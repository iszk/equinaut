import { Decimal } from "decimal.js";
import type {
  BitflyerBalance,
  BitflyerCollateral,
  BitflyerCollateralAccount,
  BitflyerPosition,
  BitflyerTicker,
  HoldingSnapshot,
  SourceObservationError,
} from "./types.js";

type MappingResult =
  | { status: "success"; holdings: HoldingSnapshot[]; metadata?: Record<string, unknown> }
  | { status: "partial"; error: SourceObservationError; holdings: HoldingSnapshot[]; metadata?: Record<string, unknown> };

const symbolFor = (currencyCode: string): string => currencyCode.toUpperCase();

const tickerFor = (symbol: string, tickers: Record<string, BitflyerTicker>): BitflyerTicker | undefined =>
  tickers[`${symbol}_JPY`];

const cashRawFor = (endpoint: string, input: Record<string, string>) => ({
  source: "bitflyer",
  endpoint,
  ...input,
});

const cryptoRawFor = (endpoint: string, input: Record<string, string>) => ({
  source: "bitflyer",
  endpoint,
  ...input,
});

export const mapBitflyerSpotBalancesToHoldings = ({
  balances,
  tickers,
}: {
  balances: BitflyerBalance[];
  tickers: Record<string, BitflyerTicker>;
}): MappingResult => {
  const holdings: HoldingSnapshot[] = [];

  for (const balance of balances) {
    const quantity = new Decimal(balance.amount);
    if (quantity.isZero()) {
      continue;
    }

    const symbol = symbolFor(balance.currency_code);
    if (symbol === "JPY") {
      holdings.push({
        assetKey: "bitflyer:spot_account:cash:JPY",
        assetType: "cash",
        symbol,
        quantity: balance.amount,
        price: "1",
        priceCurrency: "JPY",
        fxToJpy: "1",
        valueJpy: balance.amount,
        raw: cashRawFor("GET /v1/me/getbalance", {
          currency_code: balance.currency_code,
          amount: balance.amount,
          available: balance.available,
        }),
      });
      continue;
    }

    const ticker = tickerFor(symbol, tickers);
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
      assetKey: `bitflyer:spot_account:crypto:${symbol}`,
      assetType: "crypto",
      symbol,
      quantity: balance.amount,
      price: ticker.ltp,
      priceCurrency: "JPY",
      fxToJpy: "1",
      valueJpy: quantity.mul(ticker.ltp).toString(),
      raw: cryptoRawFor("GET /v1/me/getbalance", {
        currency_code: balance.currency_code,
        amount: balance.amount,
        available: balance.available,
      }),
    });
  }

  return { status: "success", holdings };
};

const collateralAccountValue = (
  account: BitflyerCollateralAccount,
  tickers: Record<string, BitflyerTicker>,
): { status: "success"; holding: HoldingSnapshot; valueJpy: Decimal } | { status: "missing_ticker"; symbol: string } | undefined => {
  const quantity = new Decimal(account.amount);
  if (quantity.isZero()) {
    return undefined;
  }

  const symbol = symbolFor(account.currency_code);
  if (symbol === "JPY") {
    return {
      status: "success",
      holding: {
        assetKey: "bitflyer:cfd_account:cash:JPY",
        assetType: "cash",
        symbol,
        quantity: account.amount,
        price: "1",
        priceCurrency: "JPY",
        fxToJpy: "1",
        valueJpy: account.amount,
        raw: cashRawFor("GET /v1/me/getcollateralaccounts", {
          currency_code: account.currency_code,
          amount: account.amount,
        }),
      },
      valueJpy: quantity,
    };
  }

  const ticker = tickerFor(symbol, tickers);
  if (ticker === undefined) {
    return { status: "missing_ticker", symbol };
  }

  const valueJpy = quantity.mul(ticker.ltp);
  return {
    status: "success",
    holding: {
      assetKey: `bitflyer:cfd_account:crypto:${symbol}`,
      assetType: "crypto",
      symbol,
      quantity: account.amount,
      price: ticker.ltp,
      priceCurrency: "JPY",
      fxToJpy: "1",
      valueJpy: valueJpy.toString(),
      raw: cryptoRawFor("GET /v1/me/getcollateralaccounts", {
        currency_code: account.currency_code,
        amount: account.amount,
      }),
    },
    valueJpy,
  };
};

const positionsRaw = (positions: BitflyerPosition[]): Record<string, unknown>[] =>
  positions.map((position) => ({
    product_code: position.product_code,
    side: position.side,
    price: position.price,
    size: position.size,
    commission: position.commission,
    swap_point_accumulate: position.swap_point_accumulate,
    require_collateral: position.require_collateral,
    open_date: position.open_date,
    leverage: position.leverage,
    pnl: position.pnl,
    ...(position.sfd === undefined ? {} : { sfd: position.sfd }),
    ...(position.funding_fees === undefined ? {} : { funding_fees: position.funding_fees }),
  }));

export const mapBitflyerCfdToHoldings = ({
  collateral,
  collateralAccounts,
  positions,
  tickers,
}: {
  collateral: BitflyerCollateral;
  collateralAccounts: BitflyerCollateralAccount[];
  positions: BitflyerPosition[];
  tickers: Record<string, BitflyerTicker>;
}): MappingResult => {
  const holdings: HoldingSnapshot[] = [];
  let collateralAccountsValueJpy = new Decimal(0);

  for (const account of collateralAccounts) {
    const result = collateralAccountValue(account, tickers);
    if (result === undefined) {
      continue;
    }

    if (result.status === "missing_ticker") {
      return {
        status: "partial",
        error: {
          code: "missing_ticker",
          message: `Missing JPY ticker for ${result.symbol}`,
          retryable: false,
          category: "valuation",
        },
        holdings,
      };
    }

    holdings.push(result.holding);
    collateralAccountsValueJpy = collateralAccountsValueJpy.plus(result.valueJpy);
  }

  const openPositionPnl = new Decimal(collateral.open_position_pnl);
  if (!openPositionPnl.isZero()) {
    holdings.push({
      assetKey: "bitflyer:cfd_account:cfd:JPY:unrealized_pnl",
      assetType: "cfd",
      symbol: "JPY",
      name: "CFD評価損益",
      quantity: collateral.open_position_pnl,
      price: "1",
      priceCurrency: "JPY",
      fxToJpy: "1",
      valueJpy: collateral.open_position_pnl,
      raw: {
        source: "bitflyer",
        endpoint: "GET /v1/me/getcollateral",
        open_position_pnl: collateral.open_position_pnl,
      },
    });
  }

  const collateralJpy = new Decimal(collateral.collateral);
  return {
    status: "success",
    holdings,
    metadata: {
      collateral_check: {
        collateral_jpy: collateral.collateral,
        collateral_accounts_value_jpy: collateralAccountsValueJpy.toString(),
        collateral_difference_jpy: collateralJpy.minus(collateralAccountsValueJpy).toString(),
      },
      positions: positionsRaw(positions),
    },
  };
};
