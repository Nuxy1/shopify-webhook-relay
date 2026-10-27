import { createHmac, timingSafeEqual } from "node:crypto";

// Shopify signs the raw request body with the app's webhook secret (HMAC-SHA256, base64) in X-Shopify-Hmac-Sha256.
// Verify against the RAW bytes: re-serialised JSON will not match.
export function verifyShopify(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(String(signature), "base64");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
