export type RequestTimeout = {
  signal: AbortSignal;
  didTimeout(): boolean;
  cleanup(): void;
};

export const createRequestTimeout = (timeoutMs: number): RequestTimeout => {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      if (timer === undefined) {
        return;
      }

      clearTimeout(timer);
      timer = undefined;
    },
  };
};
