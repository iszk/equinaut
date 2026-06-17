const sensitiveKeys = new Set([
  "accesskey",
  "accesssignature",
  "accessrequesttime",
  "signaturepayload",
  "authorization",
  "apikey",
  "apisecret",
  "token",
  "cookie",
  "setcookie",
  "password",
  "otp",
  "smscode",
]);

const normalizeKey = (key: string): string => key.toLowerCase().replaceAll(/[_-]/g, "");

const redactSensitiveValueWithSeen = (value: unknown, seen: WeakSet<object>): unknown => {
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
    try {
      return value.map((item) => redactSensitiveValueWithSeen(item, seen));
    } finally {
      seen.delete(value);
    }
  }

  if (value !== null && typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
    try {
      const output: Record<string, unknown> = {};
      for (const [key, nestedValue] of Object.entries(value)) {
        output[key] = sensitiveKeys.has(normalizeKey(key))
          ? "[REDACTED]"
          : redactSensitiveValueWithSeen(nestedValue, seen);
      }
      return output;
    } finally {
      seen.delete(value);
    }
  }

  return value;
};

export const redactSensitiveValue = (value: unknown): unknown => redactSensitiveValueWithSeen(value, new WeakSet());
