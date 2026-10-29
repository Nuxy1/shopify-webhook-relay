import { appendFile, mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { COLUMNS } from "../transform.js";

// A cell Excel or Sheets would run as a formula (= + - @ tab or CR first) gets a leading ' so it opens as text: a
// customer can type "=HYPERLINK(...)" as their name at checkout. Plain numbers like -12.50 or +15550104477 stay as they are.
export const formulaSafe = (text) => (/^[=+\-@\t\r]/.test(text) && !/^[+-]?\d+(\.\d+)?$/.test(text) ? `'${text}` : text);

export function csvLine(values) {
  return values.map((value) => {
    const text = formulaSafe(String(value ?? ""));
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
