import { describe, expect, it, vi } from "vitest";
import { cleanupTestSchema, isTestDatabaseUrlConfigured } from "./test-database.js";

describe("isTestDatabaseUrlConfigured", () => {
  it.each([undefined, "", "   "])("returns false for missing or blank values", (value) => {
    expect(isTestDatabaseUrlConfigured(value)).toBe(false);
  });

  it("returns true for non-blank values", () => {
    expect(isTestDatabaseUrlConfigured("postgres://user:pass@localhost:5432/test_db")).toBe(true);
  });
});

describe("cleanupTestSchema", () => {
  it("closes the SQL client even when dropping the schema fails", async () => {
    const dropError = new Error("drop failed");
    const client = {
      unsafe: vi.fn<() => Promise<unknown>>().mockRejectedValue(dropError),
      end: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };

    await expect(cleanupTestSchema(client, "test_0123456789abcdef")).rejects.toThrow(dropError);
    expect(client.end).toHaveBeenCalledOnce();
  });
});
