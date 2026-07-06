import { z } from "zod";

export const portfolioSnapshotV1SchemaVersion = "portfolio-snapshot.v1";

export const portfolioSnapshotV1AssetClassValues = [
  "cash",
  "stock",
  "etf",
  "fund",
  "bond",
  "option",
  "future",
  "cfd",
  "fx",
] as const;

export const portfolioSnapshotV1PositionSideValues = ["long", "short", "flat"] as const;

export const portfolioSnapshotV1DecimalStringPattern = "^-?(?:0|[1-9]\\d*)(?:\\.\\d+)?$";

const decimalStringSchema = z
  .string()
  .regex(new RegExp(portfolioSnapshotV1DecimalStringPattern), "decimal must be a base-10 string without exponent notation");

const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, "currency must be an ISO 4217 uppercase code");

const sourceMetadataSchema = z.record(z.string(), z.json());

const portfolioSnapshotSourceSchema = z
  .object({
    id: z.string().min(1),
    provider: z.string().min(1),
    exporter: z.string().min(1).optional(),
  })
  .strict();

const portfolioSnapshotAccountSchema = z
  .object({
    sourceAccountId: z.string().min(1),
    name: z.string().min(1).optional(),
    accountType: z.string().min(1).optional(),
    baseCurrency: currencyCodeSchema.optional(),
    sourceMetadata: sourceMetadataSchema.optional(),
  })
  .strict();

const portfolioSnapshotCashBalanceSchema = z
  .object({
    sourceAccountId: z.string().min(1),
    currency: currencyCodeSchema,
    amount: decimalStringSchema,
    valueJpy: decimalStringSchema,
    fxRateToJpy: decimalStringSchema.optional(),
    sourceBalanceId: z.string().min(1).optional(),
    sourceMetadata: sourceMetadataSchema.optional(),
  })
  .strict();

const portfolioSnapshotPositionSchema = z
  .object({
    sourceAccountId: z.string().min(1),
    sourcePositionId: z.string().min(1),
    sourceInstrumentId: z.string().min(1),
    assetClass: z.enum(portfolioSnapshotV1AssetClassValues),
    symbol: z.string().min(1),
    name: z.string().min(1).optional(),
    quantity: decimalStringSchema,
    side: z.enum(portfolioSnapshotV1PositionSideValues).optional(),
    price: decimalStringSchema.optional(),
    priceCurrency: currencyCodeSchema.optional(),
    valueJpy: decimalStringSchema,
    costBasisJpy: decimalStringSchema.optional(),
    unrealizedPnlJpy: decimalStringSchema.optional(),
    sourceMetadata: sourceMetadataSchema.optional(),
  })
  .strict();

export const portfolioSnapshotV1Schema = z
  .object({
    schemaVersion: z.literal(portfolioSnapshotV1SchemaVersion),
    source: portfolioSnapshotSourceSchema,
    generatedAt: z.iso.datetime(),
    dataAsOf: z.iso.datetime(),
    baseCurrency: currencyCodeSchema,
    accounts: z.array(portfolioSnapshotAccountSchema).min(1),
    cashBalances: z.array(portfolioSnapshotCashBalanceSchema),
    positions: z.array(portfolioSnapshotPositionSchema),
    sourceMetadata: sourceMetadataSchema.optional(),
  })
  .strict();

export type PortfolioSnapshotV1 = z.infer<typeof portfolioSnapshotV1Schema>;
export type PortfolioSnapshotV1AssetClass = (typeof portfolioSnapshotV1AssetClassValues)[number];
export type PortfolioSnapshotV1PositionSide = (typeof portfolioSnapshotV1PositionSideValues)[number];

export const portfolioSnapshotV1Example: PortfolioSnapshotV1 = {
  schemaVersion: portfolioSnapshotV1SchemaVersion,
  source: {
    id: "saxo-bank",
    provider: "Saxo Bank",
    exporter: "gcp-portfolio-exporter",
  },
  generatedAt: "2026-07-06T03:00:00Z",
  dataAsOf: "2026-07-06T02:59:30Z",
  baseCurrency: "JPY",
  accounts: [
    {
      sourceAccountId: "saxo-account-001",
      name: "Saxo Main Account",
      accountType: "margin",
      baseCurrency: "JPY",
      sourceMetadata: {
        accountKey: "masked-account-key",
      },
    },
  ],
  cashBalances: [
    {
      sourceAccountId: "saxo-account-001",
      currency: "JPY",
      amount: "125000.000000000000000000",
      valueJpy: "125000.000000000000000000",
      fxRateToJpy: "1.000000000000000000",
      sourceBalanceId: "saxo-account-001:JPY",
    },
    {
      sourceAccountId: "saxo-account-001",
      currency: "USD",
      amount: "250.120000000000000000",
      valueJpy: "39268.840000000000000000",
      fxRateToJpy: "156.999000000000000000",
      sourceBalanceId: "saxo-account-001:USD",
    },
  ],
  positions: [
    {
      sourceAccountId: "saxo-account-001",
      sourcePositionId: "position-7203",
      sourceInstrumentId: "uic-123456",
      assetClass: "stock",
      symbol: "7203.T",
      name: "Toyota Motor Corp.",
      quantity: "100.000000000000000000",
      side: "long",
      price: "3300.000000000000000000",
      priceCurrency: "JPY",
      valueJpy: "330000.000000000000000000",
      costBasisJpy: "300000.000000000000000000",
      unrealizedPnlJpy: "30000.000000000000000000",
      sourceMetadata: {
        exchangeId: "XTKS",
      },
    },
    {
      sourceAccountId: "saxo-account-001",
      sourcePositionId: "position-us-etf",
      sourceInstrumentId: "uic-789012",
      assetClass: "etf",
      symbol: "VOO",
      name: "Vanguard S&P 500 ETF",
      quantity: "3.250000000000000000",
      side: "long",
      price: "500.120000000000000000",
      priceCurrency: "USD",
      valueJpy: "255186.230000000000000000",
      sourceMetadata: {
        exchangeId: "ARCX",
      },
    },
    {
      sourceAccountId: "saxo-account-001",
      sourcePositionId: "position-cfd-btc",
      sourceInstrumentId: "uic-345678",
      assetClass: "cfd",
      symbol: "BTCJPY",
      name: "Bitcoin CFD",
      quantity: "0.100000000000000000",
      side: "long",
      price: "9800000.000000000000000000",
      priceCurrency: "JPY",
      valueJpy: "980000.000000000000000000",
      unrealizedPnlJpy: "-15000.000000000000000000",
    },
  ],
  sourceMetadata: {
    contractOwner: "equinaut",
  },
};

export const parsePortfolioSnapshotV1 = (input: unknown): PortfolioSnapshotV1 => {
  return portfolioSnapshotV1Schema.parse(input);
};
