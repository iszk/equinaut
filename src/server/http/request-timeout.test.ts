import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequestTimeout } from "./request-timeout.js";

describe("createRequestTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts the signal and marks the request when the timeout elapses", () => {
    vi.useFakeTimers();
    const requestTimeout = createRequestTimeout(1000);

    expect(requestTimeout.signal.aborted).toBe(false);
    expect(requestTimeout.didTimeout()).toBe(false);

    vi.advanceTimersByTime(1000);

    expect(requestTimeout.signal.aborted).toBe(true);
    expect(requestTimeout.didTimeout()).toBe(true);
    requestTimeout.cleanup();
  });

  it("cleans up before the timeout without aborting and is idempotent", () => {
    vi.useFakeTimers();
    const requestTimeout = createRequestTimeout(1000);

    requestTimeout.cleanup();
    requestTimeout.cleanup();
    vi.advanceTimersByTime(1000);

    expect(requestTimeout.signal.aborted).toBe(false);
    expect(requestTimeout.didTimeout()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
