import { createHmac } from "node:crypto";

export type BitbankAuthHeaderInput = {
  apiKey: string;
  apiSecret: string;
  requestPathWithQuery: string;
  requestTime: string;
  timeWindow: string;
};

export type BitbankAuthHeaders = {
  "ACCESS-KEY": string;
  "ACCESS-REQUEST-TIME": string;
  "ACCESS-TIME-WINDOW": string;
  "ACCESS-SIGNATURE": string;
};

export const createGetSigningPayload = (
  requestTime: string,
  timeWindow: string,
  requestPathWithQuery: string,
): string => `${requestTime}${timeWindow}${requestPathWithQuery}`;

export const createBitbankAuthHeaders = ({
  apiKey,
  apiSecret,
  requestPathWithQuery,
  requestTime,
  timeWindow,
}: BitbankAuthHeaderInput): BitbankAuthHeaders => {
  const signaturePayload = createGetSigningPayload(requestTime, timeWindow, requestPathWithQuery);
  const signature = createHmac("sha256", apiSecret).update(signaturePayload).digest("hex");

  return {
    "ACCESS-KEY": apiKey,
    "ACCESS-REQUEST-TIME": requestTime,
    "ACCESS-TIME-WINDOW": timeWindow,
    "ACCESS-SIGNATURE": signature,
  };
};
