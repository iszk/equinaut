const sensitiveKeys = new Set([
  "accesskey",
  "accesssignature",
  "accessrequesttime",
  "signaturepayload",
  "apikey",
  "apisecret",
  "token",
  "cookie",
  "password",
  "otp",
  "smscode",
]);

const normalizeKey = (key: string): string => key.toLowerCase().replaceAll(/[_-]/g, "");

export const redactSensitiveValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValue(item));
  }

  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      output[key] = sensitiveKeys.has(normalizeKey(key)) ? "[REDACTED]" : redactSensitiveValue(nestedValue);
    }
    return output;
  }

  return value;
};
