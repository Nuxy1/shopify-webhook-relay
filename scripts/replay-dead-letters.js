// Delivers every dead letter again to the sinks that failed it (after fixing what broke: a revoked key, a renamed
// sheet tab). Those that fail again are written back as new dead letters; the old file is kept as .replayed.
import { existsSync, renameSync, readFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { createRelay } from "../src/relay.js";

const config = loadConfig();
if (!existsSync(config.deadLetterPath)) {
  console.log("no dead letters");
  process.exit(0);
}
const entries = readFileSync(config.deadLetterPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
renameSync(config.deadLetterPath, `${config.deadLetterPath}.${Date.now()}.replayed`);
const relay = createRelay(config);
let still = 0;
for (const entry of entries) still += (await relay.replay(entry)).length ? 1 : 0;
console.log(`replayed ${entries.length}, ${still} still failing (see ${config.deadLetterPath})`);
