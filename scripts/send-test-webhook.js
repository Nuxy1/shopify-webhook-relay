// Sends the sample order to a running relay, signed as Shopify signs it: `npm start` in one terminal, `npm run demo` in another.
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const url = process.argv[2] || `http://localhost:${process.env.PORT || 3000}/webhooks/shopify/orders`;
const secret = process.env.SHOPIFY_WEBHOOK_SECRET || "dev-secret";
const body = readFileSync(new URL("../fixtures/shopify-order.json", import.meta.url));
const response = await fetch(url, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-shopify-topic": "orders/create",
    "x-shopify-webhook-id": randomUUID(),
    "x-shopify-hmac-sha256": createHmac("sha256", secret).update(body).digest("base64"),
  },
  body,
});
console.log(response.status, await response.text());
