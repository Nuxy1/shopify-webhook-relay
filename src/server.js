import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { createRelay } from "./relay.js";

const LIMIT = 1024 * 1024; // Shopify order payloads are a few KB; refuse anything far bigger

export function makeServer(relay, path = "/webhooks/shopify/orders") {
  return createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") return response.writeHead(200).end("ok");
    if (request.method !== "POST" || request.url !== path) return response.writeHead(404).end("not found");
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > LIMIT) {
        response.writeHead(413).end("too large");
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on("end", () => {
      if (response.writableEnded) return;
      const { status, body } = relay.handle(Buffer.concat(chunks), request.headers);
      response.writeHead(status, { "content-type": "text/plain" }).end(body);
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  const relay = createRelay(config);
  const server = makeServer(relay).listen(config.port, () => {
    console.log(`[relay] listening on :${config.port}, sinks: ${config.sinks.map((sink) => sink.name).join(", ")}`);
  });
  const stop = () => server.close(async () => {
    await relay.drain(); // (deliveries already acknowledged to Shopify finish before exit)
    process.exit(0);
  });
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
