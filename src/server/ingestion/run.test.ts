import { beforeEach, describe, expect, it, vi } from "vitest";

const loadBitbankCredentials = vi.fn();
const loadBitflyerCredentials = vi.fn();
const loadSaxoPortfolioCredentials = vi.fn();
const createBitbankHttpClient = vi.fn();
const createBitflyerHttpClient = vi.fn();
const collectBitbankSpotAccount = vi.fn();
const collectBitflyerAccounts = vi.fn();
const collectSaxoPortfolio = vi.fn();
const createDbClient = vi.fn();
const createDrizzleIngestionPersistenceDriver = vi.fn();
const persistBitbankSpotObservation = vi.fn();
const persistSourceObservation = vi.fn();

vi.mock("../config/secrets.js", () => ({ loadBitbankCredentials, loadBitflyerCredentials, loadSaxoPortfolioCredentials }));
vi.mock("../sources/bitbank/client.js", () => ({ createBitbankHttpClient }));
vi.mock("../sources/bitflyer/client.js", () => ({ createBitflyerHttpClient }));
vi.mock("../sources/bitbank/adapter.js", () => ({ collectBitbankSpotAccount }));
vi.mock("../sources/bitflyer/adapter.js", () => ({ collectBitflyerAccounts }));
vi.mock("../sources/saxo/adapter.js", () => ({
  collectSaxoPortfolio,
  saxoPortfolioSourceConfig: {
    sourceId: "saxo",
    displayName: "Saxo Bank",
    scopeId: "saxo:portfolio",
    scopeType: "portfolio",
    assetKeyPrefix: "saxo:portfolio",
  },
}));
vi.mock("../db/index.js", () => ({ createDbClient }));
vi.mock("./persistence.js", () => ({ createDrizzleIngestionPersistenceDriver, persistBitbankSpotObservation, persistSourceObservation }));

const { runBitbankIngestion, runBitflyerIngestion, runSaxoIngestion } = await import("./run.js");

describe("runBitbankIngestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadBitbankCredentials.mockReturnValue({ status: "available", apiKey: "key", apiSecret: "secret" });
    loadBitflyerCredentials.mockReturnValue({ status: "available", apiKey: "key", apiSecret: "secret" });
    loadSaxoPortfolioCredentials.mockReturnValue({
      status: "available",
      apiUrl: "https://portfolio.example/saxo",
      apiSecret: "secret",
    });
    createBitbankHttpClient.mockReturnValue({ client: true });
    createBitflyerHttpClient.mockReturnValue({ client: "bitflyer" });
    collectBitbankSpotAccount.mockResolvedValue({
      scopeId: "bitbank:spot_account",
      observedAt: new Date("2026-06-17T12:34:56.000Z"),
      status: "success",
      holdings: [],
    });
    collectBitflyerAccounts.mockResolvedValue([
      {
        scopeId: "bitflyer:spot_account",
        observedAt: new Date("2026-07-02T00:00:00.000Z"),
        status: "success",
        holdings: [{ assetKey: "bitflyer:spot_account:cash:JPY" }],
      },
      {
        scopeId: "bitflyer:cfd_account",
        observedAt: new Date("2026-07-02T00:00:00.000Z"),
        status: "success",
        holdings: [{ assetKey: "bitflyer:cfd_account:cash:JPY" }],
      },
    ]);
    collectSaxoPortfolio.mockResolvedValue({
      scopeId: "saxo:portfolio",
      observedAt: new Date("2026-07-09T00:00:00.000Z"),
      dataAsOf: new Date("2026-07-09T00:00:00.000Z"),
      status: "success",
      holdings: [{ assetKey: "saxo:portfolio:cash:JPY" }],
    });
    createDbClient.mockReturnValue({ db: { db: true }, close: vi.fn().mockResolvedValue(undefined) });
    createDrizzleIngestionPersistenceDriver.mockReturnValue({ driver: true });
    persistBitbankSpotObservation.mockResolvedValue(undefined);
    persistSourceObservation.mockResolvedValue(undefined);
  });

  it("returns the existing sanitized failure when bitbank credentials are missing", async () => {
    loadBitbankCredentials.mockReturnValue({
      status: "disabled",
      reason: "missing bitbank credentials",
      missing: ["BITBANK_API_KEY"],
    });

    await expect(runBitbankIngestion()).resolves.toEqual({
      status: "failed",
      message: "bitbank adapter disabled: missing credentials",
    });
    expect(createDbClient).not.toHaveBeenCalled();
  });

  it("returns a structured failure with details when the database client cannot be created", async () => {
    createDbClient.mockImplementation(() => {
      throw new Error("DATABASE_URL is not configured");
    });

    await expect(runBitbankIngestion()).resolves.toEqual({
      status: "failed",
      message: "bitbank ingestion failed: persistence_error - DATABASE_URL is not configured",
    });
  });

  it("redacts credentials from persistence error details", async () => {
    createDbClient.mockImplementation(() => {
      throw new Error("connect failed postgres://equinaut:secret-password@db.example/equinaut password=secret token=abc123");
    });

    await expect(runBitbankIngestion()).resolves.toEqual({
      status: "failed",
      message:
        "bitbank ingestion failed: persistence_error - connect failed postgres://[REDACTED]@db.example/equinaut password=[REDACTED] token=[REDACTED]",
    });
  });

  it("returns a structured failure and closes the database client when persistence fails", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    createDbClient.mockReturnValue({ db: { db: true }, close });
    persistBitbankSpotObservation.mockRejectedValue(new Error("insert failed"));

    await expect(runBitbankIngestion()).resolves.toEqual({
      status: "failed",
      message: "bitbank ingestion failed: persistence_error - insert failed",
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("includes adapter error details in failed ingestion output", async () => {
    collectBitbankSpotAccount.mockResolvedValue({
      scopeId: "bitbank:spot_account",
      observedAt: new Date("2026-06-17T12:34:56.000Z"),
      status: "failed",
      error: {
        code: "bitbank_response_contract_error",
        message: "bitbank API response did not match the expected schema: data.15.sell: Expected string, received null",
        retryable: false,
        category: "contract",
      },
      holdings: [],
    });

    await expect(runBitbankIngestion()).resolves.toEqual({
      status: "failed",
      message:
        "bitbank ingestion failed: bitbank_response_contract_error - bitbank API response did not match the expected schema: data.15.sell: Expected string, received null",
    });
  });

  it("redacts credentials from adapter error details", async () => {
    collectBitbankSpotAccount.mockResolvedValue({
      scopeId: "bitbank:spot_account",
      observedAt: new Date("2026-06-17T12:34:56.000Z"),
      status: "failed",
      error: {
        code: "bitbank_network_error",
        message: "request failed Authorization: Bearer CREDENTIAL Cookie=session=CREDENTIAL apiKey=CREDENTIAL",
        retryable: true,
        category: "network",
      },
      holdings: [],
    });

    await expect(runBitbankIngestion()).resolves.toEqual({
      status: "failed",
      message:
        "bitbank ingestion failed: bitbank_network_error - request failed Authorization: [REDACTED] Cookie=[REDACTED] apiKey=[REDACTED]",
    });
  });
});

describe("runSaxoIngestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadSaxoPortfolioCredentials.mockReturnValue({
      status: "available",
      apiUrl: "https://portfolio.example/saxo",
      apiSecret: "secret",
    });
    collectSaxoPortfolio.mockResolvedValue({
      scopeId: "saxo:portfolio",
      observedAt: new Date("2026-07-09T00:00:00.000Z"),
      dataAsOf: new Date("2026-07-09T00:00:00.000Z"),
      status: "success",
      holdings: [{ assetKey: "saxo:portfolio:cash:JPY" }],
    });
    createDbClient.mockReturnValue({ db: { db: true }, close: vi.fn().mockResolvedValue(undefined) });
    createDrizzleIngestionPersistenceDriver.mockReturnValue({ driver: true });
    persistSourceObservation.mockResolvedValue(undefined);
  });

  it("returns a sanitized failure when Saxo portfolio API configuration is missing", async () => {
    loadSaxoPortfolioCredentials.mockReturnValue({
      status: "disabled",
      reason: "missing saxo portfolio API configuration",
      missing: ["SAXO_PORTFOLIO_API_URL"],
    });

    await expect(runSaxoIngestion()).resolves.toEqual({
      status: "failed",
      message: "saxo adapter disabled: missing portfolio API configuration",
    });
    expect(createDbClient).not.toHaveBeenCalled();
  });

  it("persists the Saxo portfolio observation and returns a success summary", async () => {
    await expect(runSaxoIngestion()).resolves.toEqual({
      status: "success",
      message: "saxo ingestion succeeded: 1 holdings collected",
    });
    expect(persistSourceObservation).toHaveBeenCalledWith({
      driver: { driver: true },
      sourceId: "saxo",
      displayName: "Saxo Bank",
      scopeType: "portfolio",
      observation: expect.objectContaining({ scopeId: "saxo:portfolio" }),
    });
  });

  it("redacts credentials from Saxo adapter error details", async () => {
    collectSaxoPortfolio.mockResolvedValue({
      scopeId: "saxo:portfolio",
      observedAt: new Date("2026-07-09T00:00:00.000Z"),
      status: "failed",
      error: {
        code: "portfolio_snapshot_network_error",
        message: "request failed Authorization: Bearer CREDENTIAL Cookie=session=CREDENTIAL apiKey=CREDENTIAL",
        retryable: true,
        category: "network",
      },
      holdings: [],
    });

    await expect(runSaxoIngestion()).resolves.toEqual({
      status: "failed",
      message:
        "saxo ingestion failed: portfolio_snapshot_network_error - request failed Authorization: [REDACTED] Cookie=[REDACTED] apiKey=[REDACTED]",
    });
  });
});

describe("runBitflyerIngestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadBitflyerCredentials.mockReturnValue({ status: "available", apiKey: "key", apiSecret: "secret" });
    createBitflyerHttpClient.mockReturnValue({ client: "bitflyer" });
    collectBitflyerAccounts.mockResolvedValue([
      {
        scopeId: "bitflyer:spot_account",
        observedAt: new Date("2026-07-02T00:00:00.000Z"),
        status: "success",
        holdings: [{ assetKey: "bitflyer:spot_account:cash:JPY" }],
      },
      {
        scopeId: "bitflyer:cfd_account",
        observedAt: new Date("2026-07-02T00:00:00.000Z"),
        status: "success",
        holdings: [{ assetKey: "bitflyer:cfd_account:cash:JPY" }],
      },
    ]);
    createDbClient.mockReturnValue({ db: { db: true }, close: vi.fn().mockResolvedValue(undefined) });
    createDrizzleIngestionPersistenceDriver.mockReturnValue({ driver: true });
    persistSourceObservation.mockResolvedValue(undefined);
  });

  it("returns a sanitized failure when bitflyer credentials are missing", async () => {
    loadBitflyerCredentials.mockReturnValue({
      status: "disabled",
      reason: "missing bitflyer credentials",
      missing: ["BITFLYER_API_KEY"],
    });

    await expect(runBitflyerIngestion()).resolves.toEqual({
      status: "failed",
      message: "bitflyer adapter disabled: missing credentials",
    });
    expect(createDbClient).not.toHaveBeenCalled();
  });

  it("persists both bitflyer scope observations and returns a success summary", async () => {
    await expect(runBitflyerIngestion()).resolves.toEqual({
      status: "success",
      message:
        "bitflyer ingestion succeeded: 2 holdings collected (bitflyer:spot_account:success:1, bitflyer:cfd_account:success:1)",
    });
    expect(persistSourceObservation).toHaveBeenCalledTimes(2);
    expect(persistSourceObservation).toHaveBeenCalledWith({
      driver: { driver: true },
      sourceId: "bitflyer",
      displayName: "bitFlyer",
      observation: expect.objectContaining({ scopeId: "bitflyer:spot_account" }),
    });
  });

  it("returns partial when one bitflyer scope fails", async () => {
    collectBitflyerAccounts.mockResolvedValue([
      {
        scopeId: "bitflyer:spot_account",
        observedAt: new Date("2026-07-02T00:00:00.000Z"),
        status: "success",
        holdings: [],
      },
      {
        scopeId: "bitflyer:cfd_account",
        observedAt: new Date("2026-07-02T00:00:00.000Z"),
        status: "failed",
        error: {
          code: "bitflyer_network_error",
          message: "request failed Authorization: Bearer CREDENTIAL",
          retryable: true,
          category: "network",
        },
        holdings: [],
      },
    ]);

    await expect(runBitflyerIngestion()).resolves.toEqual({
      status: "partial",
      message:
        "bitflyer ingestion partial: bitflyer:spot_account:success:0, bitflyer:cfd_account:failed:bitflyer_network_error - request failed Authorization: [REDACTED]",
    });
  });
});
