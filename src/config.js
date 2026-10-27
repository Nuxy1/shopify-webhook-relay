import { readFileSync } from "node:fs";
import { csvSink } from "./sinks/csv.js";
import { notifySink } from "./sinks/notify.js";
import { sheetsSink } from "./sinks/sheets.js";

// Everything from the environment (.env when started with `npm start`); fails loudly on what is missing.
export function loadConfig(env = process.env) {
  if (!env.SHOPIFY_WEBHOOK_SECRET) throw new Error("SHOPIFY_WEBHOOK_SECRET is required (Shopify admin > Settings > Notifications > Webhooks)");
  const sinks = [];
  if (env.SHEET_ID) {
    if (!env.GOOGLE_SERVICE_ACCOUNT) throw new Error("SHEET_ID is set but GOOGLE_SERVICE_ACCOUNT (a key file path or its JSON) is not");
    const raw = env.GOOGLE_SERVICE_ACCOUNT.trim();
    const account = JSON.parse(raw.startsWith("{") ? raw : readFileSync(raw, "utf8"));
    sinks.push(sheetsSink({ account, spreadsheetId: env.SHEET_ID, range: env.SHEET_RANGE || "Orders!A1" }));
  }
  if (env.NOTIFY_WEBHOOK_URL) sinks.push(notifySink({ url: env.NOTIFY_WEBHOOK_URL }));
  if (env.CSV_PATH !== "off") sinks.push(csvSink({ path: env.CSV_PATH || "data/orders.csv" }));
  return {
    port: Number(env.PORT || 3000),
    secret: env.SHOPIFY_WEBHOOK_SECRET,
    sinks,
    deadLetterPath: env.DEAD_LETTER_PATH || "data/dead-letters.jsonl",
    transformOptions: { defaultCountryCode: env.DEFAULT_COUNTRY_CODE || "1" },
  };
}
