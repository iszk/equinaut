import { createHmac } from "node:crypto";

export type BitflyerAuthHeaderInput = {
  apiKey: string;
  apiSecret: string;
  method: "GET" | "POST";
  requestPathWithQuery: string;
  body?: string;
  timestamp: string;
};

export type BitflyerAuthHeaders = {
  "ACCESS-KEY": string;
  "ACCESS-TIMESTAMP": string;
  "ACCESS-SIGN": string;
};

export const createSigningPayload = ({
  timestamp,
  method,
  requestPathWithQuery,
  body = "",
}: {
  timestamp: string;
  method: "GET" | "POST";
  requestPathWithQuery: string;
  body?: string;
}): string => `${timestamp}${method}${requestPathWithQuery}${body}`;

export const createBitflyerAuthHeaders = ({
  apiKey,
  apiSecret,
  method,
  requestPathWithQuery,
  body = "",
  timestamp,
}: BitflyerAuthHeaderInput): BitflyerAuthHeaders => {
  const signaturePayload = createSigningPayload({ timestamp, method, requestPathWithQuery, body });
  const signature = createHmac("sha256", apiSecret).update(signaturePayload).digest("hex");

  return {
    "ACCESS-KEY": apiKey,
    "ACCESS-TIMESTAMP": timestamp,
    "ACCESS-SIGN": signature,
  };
};
