import assert from "node:assert/strict";
import { createHmac, createVerify, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Seen } from "../src/dedupe.js";
import { createRelay } from "../src/relay.js";
import { HttpError, withRetry } from "../src/retry.js";
import { makeServer } from "../src/server.js";
import { csvLine, csvSink } from "../src/sinks/csv.js";
import { serviceAccountJwt, sheetsSink } from "../src/sinks/sheets.js";
import { normalizePhone, orderToRow } from "../src/transform.js";
import { verifyShopify } from "../src/verify.js";

const SECRET = "test-secret";
const body = readFileSync(new URL("../fixtures/shopify-order.json", import.meta.url));
const sign = (raw, secret = SECRET) => createHmac("sha256", secret).update(raw).digest("base64");
const headers = (raw, id = "wh-1") => ({ "x-shopify-hmac-sha256": sign(raw), "x-shopify-webhook-id": id });
const quiet = { info() {}, error() {} };
const noWait = { sleep: async () => {}, attempts: 3 };

function memorySink(name = "memory", failures = 0, retryable = true) {
  const rows = [];
  let left = failures;
  return {
    name, rows,
    async write(values) {
      if (left-- > 0) throw Object.assign(new Error(`${name} down`), { retryable });
      rows.push(values);
    },
  };
}

test("signature: right secret passes, anything else fails", () => {
  assert.equal(verifyShopify(body, sign(body), SECRET), true);
  assert.equal(verifyShopify(body, sign(body, "wrong"), SECRET), false);
  assert.equal(verifyShopify(Buffer.concat([body, Buffer.from(" ")]), sign(body), SECRET), false);
  assert.equal(verifyShopify(body, undefined, SECRET), false);
  assert.equal(verifyShopify(body, "c2hvcnQ=", SECRET), false); // (wrong length: timingSafeEqual would throw)
});

test("transform: the sample order flattened", () => {
  const row = orderToRow(JSON.parse(body));
  assert.deepEqual(row, {
    order: "#1042", created_at: "2026-10-27T14:15:00.000Z", customer: "Jordan Example", email: "jordan.example@example.com",
    phone: "+15550104477", items: "2 x Ceramic Mug (Ash Grey); 1 x Pour-Over Kit", item_count: 3, total: "84.50",
    currency: "USD", city: "Columbus", country: "US", payment: "paid",
  });
});

test("phone numbers to E.164", () => {
  assert.equal(normalizePhone("(555) 010-4477"), "+15550104477");
  assert.equal(normalizePhone("1-555-010-4477"), "+15550104477");
  assert.equal(normalizePhone("+44 20 7946 0958"), "+442079460958");
  assert.equal(normalizePhone("0044 20 7946 0958"), "+442079460958");
  assert.equal(normalizePhone("020 7946 0958", "44"), "+442079460958");
  assert.equal(normalizePhone(""), "");
  assert.equal(normalizePhone(null), "");
});

test("dedupe keeps the newest ids", () => {
  const seen = new Seen(2);
  assert.equal(seen.add("a"), true);
  assert.equal(seen.add("a"), false);
  seen.add("b");
  seen.add("c");
  assert.equal(seen.add("a"), true); // (evicted)
});

test("retry: retryable errors retried, others not, last error thrown", async () => {
  let calls = 0;
  assert.equal(await withRetry(async () => (++calls < 3 ? Promise.reject(new HttpError(503, "busy")) : "done"), noWait), "done");
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw new HttpError(400, "bad request"); }, noWait), /bad request/);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw new HttpError(500, "down"); }, noWait), /down/);
  assert.equal(calls, 3);
});

test("relay: bad signature refused, duplicate delivered once", async () => {
  const sink = memorySink();
  const relay = createRelay({ secret: SECRET, sinks: [sink], retry: noWait, log: quiet });
  assert.equal(relay.handle(body, { "x-shopify-hmac-sha256": sign(body, "nope") }).status, 401);
  const first = relay.handle(body, headers(body));
  assert.equal(first.status, 200);
  assert.equal(relay.handle(body, headers(body)).body, "duplicate");
  await relay.drain();
  assert.equal(sink.rows.length, 1);
  assert.equal(sink.rows[0][0], "#1042");
});

test("relay: a flaky sink is retried; a dead one is dead-lettered and replayed later", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-"));
  const deadLetterPath = join(dir, "dead.jsonl");
  const flaky = memorySink("flaky", 2);
  const dead = memorySink("dead", 99);
  const relay = createRelay({ secret: SECRET, sinks: [flaky, dead], retry: noWait, deadLetterPath, log: quiet });
  relay.handle(body, headers(body, "wh-2"));
  await relay.drain();
  assert.equal(flaky.rows.length, 1);
  const [entry] = readFileSync(deadLetterPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(entry.failed.map((each) => each.sink), ["dead"]);
  const fixed = memorySink("dead");
  const later = createRelay({ secret: SECRET, sinks: [flaky, fixed], retry: noWait, log: quiet });
  assert.deepEqual(await later.replay(entry), []);
  assert.equal(fixed.rows.length, 1);
  assert.equal(flaky.rows.length, 1); // (the sink that had it already is not written twice)
});

test("server: a signed POST is answered 200 and lands in the CSV", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-"));
  const csv = join(dir, "orders.csv");
  const relay = createRelay({ secret: SECRET, sinks: [csvSink({ path: csv })], retry: noWait, log: quiet });
  const server = makeServer(relay).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${url}/webhooks/shopify/orders`, { method: "POST", headers: headers(body, "wh-3"), body });
    assert.equal(response.status, 200);
    assert.equal((await fetch(`${url}/health`)).status, 200);
    assert.equal((await fetch(`${url}/nope`, { method: "POST" })).status, 404);
    await relay.drain();
    const lines = readFileSync(csv, "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
    assert.match(lines[1], /^#1042,2026-10-27T14:15:00.000Z,Jordan Example,/);
  } finally {
    server.close();
  }
});

test("csv escapes commas, quotes and newlines", () => {
  assert.equal(csvLine(["a", "b,c", 'say "hi"', "x\ny", 3]), 'a,"b,c","say ""hi""","x\ny",3\n');
});

test("sheets: a valid RS256 service-account JWT, then an append with its token", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const account = { client_email: "relay@demo.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) };
  const jwt = serviceAccountJwt(account, 1_000_000);
  const [head, claims, signature] = jwt.split(".");
  assert.equal(createVerify("RSA-SHA256").update(`${head}.${claims}`).verify(publicKey, Buffer.from(signature, "base64url")), true);
  assert.equal(JSON.parse(Buffer.from(claims, "base64url")).exp, 1_003_600);

  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }), text: async () => "" };
  };
  const sink = sheetsSink({ account, spreadsheetId: "sheet123", range: "Orders!A1", fetchImpl });
  await sink.write(["#1042", 3]);
  await sink.write(["#1043", 1]);
  assert.equal(calls.filter((call) => call.url.includes("oauth2")).length, 1); // (token cached)
  const append = calls.at(-1);
  assert.match(append.url, /spreadsheets\/sheet123\/values\/Orders!A1:append\?valueInputOption=USER_ENTERED/);
  assert.equal(append.init.headers.authorization, "Bearer tok");
  assert.deepEqual(JSON.parse(append.init.body), { values: [["#1043", 1]] });
});
