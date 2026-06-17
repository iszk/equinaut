import { beforeEach, describe, expect, it, vi } from "vitest";

const loadBitbankCredentials = vi.fn();
const createBitbankHttpClient = vi.fn();
const collectBitbankSpotAccount = vi.fn();
const createDbClient = vi.fn();
const createDrizzleIngestionPersistenceDriver = vi.fn();
const persistBitbankSpotObservation = vi.fn();

vi.mock("../config/secrets.js", () => ({ loadBitbankCredentials }));
vi.mock("../sources/bitbank/client.js", () => ({ createBitbankHttpClient }));
vi.mock("../sources/bitbank/adapter.js", () => ({ collectBitbankSpotAccount }));
vi.mock("../db/index.js", () => ({ createDbClient }));
vi.mock("./persistence.js", () => ({ createDrizzleIngestionPersistenceDriver, persistBitbankSpotObservation }));

const { runBitbankIngestion } = await import("./run.js");

describe("runBitbankIngestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadBitbankCredentials.mockReturnValue({ status: "available", apiKey: "key", apiSecret: "secret" });
    createBitbankHttpClient.mockReturnValue({ client: true });
    collectBitbankSpotAccount.mockResolvedValue({
      scopeId: "bitbank:spot_account",
      observedAt: new Date("2026-06-17T12:34:56.000Z"),
      status: "success",
      holdings: [],
    });
    createDbClient.mockReturnValue({ db: { db: true }, close: vi.fn().mockResolvedValue(undefined) });
    createDrizzleIngestionPersistenceDriver.mockReturnValue({ driver: true });
    persistBitbankSpotObservation.mockResolvedValue(undefined);
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

  it("returns a structured failure when the database client cannot be created", async () => {
    createDbClient.mockImplementation(() => {
      throw new Error("DATABASE_URL is not configured");
    });

    await expect(runBitbankIngestion()).resolves.toEqual({
      status: "failed",
      message: "bitbank ingestion failed: persistence_error",
    });
  });

  it("returns a structured failure and closes the database client when persistence fails", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    createDbClient.mockReturnValue({ db: { db: true }, close });
    persistBitbankSpotObservation.mockRejectedValue(new Error("insert failed"));

    await expect(runBitbankIngestion()).resolves.toEqual({
      status: "failed",
      message: "bitbank ingestion failed: persistence_error",
    });
    expect(close).toHaveBeenCalledOnce();
  });
});
