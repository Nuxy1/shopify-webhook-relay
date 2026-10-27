import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Seen } from "./dedupe.js";
import { withRetry } from "./retry.js";
import { orderToRow, rowValues } from "./transform.js";
import { verifyShopify } from "./verify.js";

// The webhook's whole job: verify, answer at once (Shopify gives up after 5 s and retries), then deliver the row to
// every sink on its own, each retried; what still fails goes to the dead-letter file to be replayed later.
export function createRelay({ secret, sinks, seen = new Seen(), retry = {}, deadLetterPath, transformOptions, log = console }) {
  const inFlight = new Set();

  async function deliver(id, order, only) {
    const row = orderToRow(order, transformOptions);
    const values = rowValues(row);
    const failed = [];
    for (const sink of sinks) {
      if (only && !only.includes(sink.name)) continue;
      try {
        await withRetry(() => sink.write(values, row), retry);
      } catch (error) {
        failed.push({ sink: sink.name, error: error.message });
        log.error?.(`[relay] ${id}: ${sink.name} failed for good: ${error.message}`);
      }
    }
    if (failed.length && deadLetterPath) {
      await mkdir(dirname(deadLetterPath), { recursive: true });
      await appendFile(deadLetterPath, JSON.stringify({ at: new Date().toISOString(), id, failed, order }) + "\n");
    }
    const tried = only?.length ?? sinks.length;
    log.info?.(`[relay] ${id}: ${row.order} delivered to ${tried - failed.length}/${tried}`);
    return failed;
  }

  function track(promise) {
    inFlight.add(promise);
    promise.finally(() => inFlight.delete(promise));
    return promise;
  }

  return {
    handle(rawBody, headers) {
      if (!verifyShopify(rawBody, headers["x-shopify-hmac-sha256"], secret)) return { status: 401, body: "bad signature" };
      let order;
      try {
        order = JSON.parse(rawBody.toString("utf8"));
      } catch {
        return { status: 400, body: "bad json" };
      }
      const id = headers["x-shopify-webhook-id"] ?? headers["x-shopify-event-id"] ?? `${headers["x-shopify-topic"] ?? "order"}:${order.id}`;
      if (!seen.add(id)) return { status: 200, body: "duplicate" };
      const job = track(deliver(id, order).catch((error) => log.error?.(`[relay] ${id}: ${error.stack}`)));
      return { status: 200, body: "ok", job };
    },
    // A dead letter delivered again to the sinks that failed it.
    replay(entry) {
      return track(deliver(entry.id, entry.order, entry.failed.map((each) => each.sink)));
    },
    drain() {
      return Promise.allSettled([...inFlight]);
    },
  };
}
