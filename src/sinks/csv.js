import { appendFile, mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { COLUMNS } from "../transform.js";

export function csvLine(values) {
  return values.map((value) => {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(",") + "\n";
}

// Rows into a local CSV: the dry run (no Google account needed) and a backup beside the sheet.
export function csvSink({ path }) {
  return {
    name: "csv",
    async write(values) {
      await mkdir(dirname(path), { recursive: true });
      const fresh = await stat(path).then(() => false, () => true);
      await appendFile(path, (fresh ? csvLine(COLUMNS) : "") + csvLine(values));
    },
  };
}
