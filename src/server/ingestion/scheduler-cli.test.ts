import { describe, expect, it } from "vitest";

import { formatSchedulerCliFailure } from "./scheduler-cli.js";

describe("formatSchedulerCliFailure", () => {
  it("preserves config read error context", () => {
    expect(
      formatSchedulerCliFailure(
        new Error(
          "failed to read ingestion scheduler config at config/ingestion.yaml: ENOENT: no such file or directory, open 'config/ingestion.yaml'",
        ),
      ),
    ).toBe(
      "ingestion scheduler failed: failed to read ingestion scheduler config at config/ingestion.yaml: ENOENT: no such file or directory, open 'config/ingestion.yaml'",
    );
  });

  it("preserves config parse error context", () => {
    expect(
      formatSchedulerCliFailure(
        new Error("failed to parse ingestion scheduler config: Nested mappings are not allowed in compact mappings"),
      ),
    ).toBe(
      "ingestion scheduler failed: failed to parse ingestion scheduler config: Nested mappings are not allowed in compact mappings",
    );
  });

  it("redacts secrets from startup failures", () => {
    expect(
      formatSchedulerCliFailure(
        new Error("failed to read ingestion scheduler config at postgres://user:pass@db/equinaut apiSecret=SECRET"),
      ),
    ).toBe(
      "ingestion scheduler failed: failed to read ingestion scheduler config at postgres://[REDACTED]@db/equinaut apiSecret=[REDACTED]",
    );
  });

  it("handles non-Error failures", () => {
    expect(formatSchedulerCliFailure("unexpected")).toBe("ingestion scheduler failed: unknown error");
  });
});
