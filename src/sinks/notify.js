import { fetchOk } from "../retry.js";

// One line about the order to a Discord or Slack incoming webhook (the URL tells which).
export function notifySink({ url, fetchImpl = fetch }) {
  const slack = new URL(url).hostname.endsWith("slack.com");
  return {
    name: slack ? "slack" : "discord",
    async write(_values, row) {
      const text = `New order ${row.order}: ${row.customer || row.email} - ${row.total} ${row.currency} (${row.item_count} item${row.item_count === 1 ? "" : "s"})`;
      await fetchOk(fetchImpl, url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(slack ? { text } : { content: text, allowed_mentions: { parse: [] } }),
      });
    },
  };
}
