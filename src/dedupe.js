// Webhook ids already handled, newest kept: Shopify delivers at least once, so a retry of a delivery we already
// processed must not append a second row.
// shortcut: in memory only, so a restart forgets; use Redis or a database table when running more than one instance.
export class Seen {
  constructor(limit = 10_000) {
    this.limit = limit;
    this.ids = new Set();
  }

  // True the first time an id is offered, false after.
  add(id) {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    if (this.ids.size > this.limit) this.ids.delete(this.ids.values().next().value);
    return true;
  }

  forget(id) {
    this.ids.delete(id);
  }
}
