import { Decimal } from "decimal.js";
import { ZodError } from "zod";
import type { ZodIssue } from "zod";
import type { BitflyerCredentials } from "../../config/secrets.js";
import type { ScopeObservationResult } from "../../ingestion/source-types.js";
import { BitflyerHttpClientError } from "./client.js";
import type { BitflyerHttpClient } from "./client.js";
import { mapBitflyerCfdToHoldings, mapBitflyerSpotBalancesToHoldings } from "./mapping.js";
import type {
  BitflyerBalance,
  BitflyerCollateralAccount,
  BitflyerHttpErrorMetadata,
  BitflyerTicker,
  SourceObservationError,
} from "./types.js";

type CollectInput = {
  credentials: BitflyerCredentials;
  client: BitflyerHttpClient;
  now?: Date;
};

export type BitflyerScopeObservationResult = ScopeObservationResult & {
  scopeId: "bitflyer:spot_account" | "bitflyer:cfd_account";
};

const formatZodIssuePath = (issue: ZodIssue): string => (issue.path.length === 0 ? "response" : issue.path.join("."));

const collectZodIssueMessages = (issues: ZodIssue[]): string[] =>
  issues.flatMap((issue) => {
    if (issue.code === "invalid_union") {
      return issue.unionErrors.flatMap((unionError) => collectZodIssueMessages(unionError.issues));
    }

    return [`${formatZodIssuePath(issue)}: ${issue.message}`];
  });

const summarizeZodError = (error: ZodError): string => {
  const uniqueMessages = [...new Set(collectZodIssueMessages(error.issues))];
  return uniqueMessages.slice(0, 8).join("; ");
};

const messageForMetadata = (metadata: BitflyerHttpErrorMetadata, zodError?: ZodError): string => {
  if (metadata.normalizedErrorCode === "rate_limited") {
    return "bitflyer rate limit exceeded";
  }

  if (metadata.normalizedErrorCode === "bitflyer_network_error") {
    return "bitflyer request failed";
  }

  if (metadata.normalizedErrorCode === "bitflyer_non_json_response") {
    return "bitflyer API response was not JSON";
  }

  if (metadata.normalizedErrorCode === "bitflyer_response_contract_error") {
    const detail = zodError === undefined ? "" : summarizeZodError(zodError);
    return `bitflyer API response did not match the expected schema${detail === "" ? "" : `: ${detail}`}`;
  }

  if (metadata.normalizedErrorCode === "bitflyer_http_error") {
    const status = metadata.httpStatus === undefined ? "" : ` (${metadata.httpStatus})`;
    return `bitflyer API returned an HTTP error${status}`;
  }

  return "bitflyer API returned an error";
};

const normalizeUnexpectedError = (error: unknown): SourceObservationError => {
  if (error instanceof BitflyerHttpClientError) {
    return {
      code: error.metadata.normalizedErrorCode,
      ...(error.metadata.rawErrorCode === undefined ? {} : { rawErrorCode: error.metadata.rawErrorCode }),
      message: messageForMetadata(error.metadata, error.zodError),
      retryable: error.metadata.retryable,
      category: error.metadata.category,
      metadata: error.metadata,
    };
  }

  if (error instanceof ZodError) {
    const detail = summarizeZodError(error);
    return {
      code: "bitflyer_response_contract_error",
      message: `bitflyer API response did not match the expected schema${detail === "" ? "" : `: ${detail}`}`,
      retryable: false,
      category: "contract",
    };
  }

  return {
    code: "bitflyer_network_error",
    message: "bitflyer request failed",
    retryable: true,
    category: "network",
  };
};

const disabledResult = (
  scopeId: "bitflyer:spot_account" | "bitflyer:cfd_account",
  credentials: Extract<BitflyerCredentials, { status: "disabled" }>,
  observedAt: Date,
): BitflyerScopeObservationResult => ({
  scopeId,
  observedAt,
  status: "failed",
  error: {
    code: "configuration_error",
    message: credentials.reason,
    retryable: false,
    category: "configuration",
  },
  holdings: [],
});

const activeNonJpyBalanceSymbols = (balances: BitflyerBalance[]): string[] => [
  ...new Set(
    balances
      .filter((balance) => !new Decimal(balance.amount).isZero())
      .map((balance) => balance.currency_code.toUpperCase())
      .filter((symbol) => symbol !== "JPY"),
  ),
];

const activeNonJpyCollateralSymbols = (accounts: BitflyerCollateralAccount[]): string[] => [
  ...new Set(
    accounts
      .filter((account) => !new Decimal(account.amount).isZero())
      .map((account) => account.currency_code.toUpperCase())
      .filter((symbol) => symbol !== "JPY"),
  ),
];

const fetchTickerMap = async (client: BitflyerHttpClient, symbols: string[]): Promise<Record<string, BitflyerTicker>> => {
  const tickers: Record<string, BitflyerTicker> = {};
  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const ticker = await client.getTicker(`${symbol}_JPY`);
        tickers[ticker.product_code] = ticker;
      } catch (error) {
        if (
          error instanceof BitflyerHttpClientError &&
          !error.metadata.retryable &&
          error.metadata.category === "api"
        ) {
          return;
        }

        throw error;
      }
    }),
  );

  return tickers;
};

const collectBitflyerSpotAccount = async ({
  client,
  now,
}: {
  client: BitflyerHttpClient;
  now: Date;
}): Promise<BitflyerScopeObservationResult> => {
  try {
    const balances = await client.getBalance();
    const tickers = await fetchTickerMap(client, activeNonJpyBalanceSymbols(balances));
    const mapped = mapBitflyerSpotBalancesToHoldings({ balances, tickers });
    if (mapped.status === "partial") {
      return {
        scopeId: "bitflyer:spot_account",
        observedAt: now,
        status: "partial",
        error: mapped.error,
        holdings: mapped.holdings,
        ...(mapped.metadata === undefined ? {} : { metadata: mapped.metadata }),
      };
    }

    return {
      scopeId: "bitflyer:spot_account",
      observedAt: now,
      status: "success",
      holdings: mapped.holdings,
      ...(mapped.metadata === undefined ? {} : { metadata: mapped.metadata }),
    };
  } catch (error) {
    return {
      scopeId: "bitflyer:spot_account",
      observedAt: now,
      status: "failed",
      error: normalizeUnexpectedError(error),
      holdings: [],
    };
  }
};

const collectBitflyerCfdAccount = async ({
  client,
  now,
}: {
  client: BitflyerHttpClient;
  now: Date;
}): Promise<BitflyerScopeObservationResult> => {
  try {
    const collateralAccounts = await client.getCollateralAccounts();
    const tickers = await fetchTickerMap(client, activeNonJpyCollateralSymbols(collateralAccounts));
    const [collateral, positions] = await Promise.all([client.getCollateral(), client.getPositions("FX_BTC_JPY")]);
    const mapped = mapBitflyerCfdToHoldings({ collateral, collateralAccounts, positions, tickers });
    if (mapped.status === "partial") {
      return {
        scopeId: "bitflyer:cfd_account",
        observedAt: now,
        status: "partial",
        error: mapped.error,
        holdings: mapped.holdings,
        ...(mapped.metadata === undefined ? {} : { metadata: mapped.metadata }),
      };
    }

    return {
      scopeId: "bitflyer:cfd_account",
      observedAt: now,
      status: "success",
      holdings: mapped.holdings,
      ...(mapped.metadata === undefined ? {} : { metadata: mapped.metadata }),
    };
  } catch (error) {
    return {
      scopeId: "bitflyer:cfd_account",
      observedAt: now,
      status: "failed",
      error: normalizeUnexpectedError(error),
      holdings: [],
    };
  }
};

export const collectBitflyerAccounts = async ({
  credentials,
  client,
  now = new Date(),
}: CollectInput): Promise<BitflyerScopeObservationResult[]> => {
  if (credentials.status === "disabled") {
    return [
      disabledResult("bitflyer:spot_account", credentials, now),
      disabledResult("bitflyer:cfd_account", credentials, now),
    ];
  }

  const [spot, cfd] = await Promise.all([
    collectBitflyerSpotAccount({ client, now }),
    collectBitflyerCfdAccount({ client, now }),
  ]);

  return [spot, cfd];
};
