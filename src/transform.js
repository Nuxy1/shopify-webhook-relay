// A Shopify order (orders/create webhook) flattened into one spreadsheet row.

export const COLUMNS = [
  "order", "created_at", "customer", "email", "phone", "items", "item_count", "total", "currency", "city", "country", "payment",
];

// Best-effort E.164: keeps an international number as given (+ or 00), and puts `defaultCountryCode` before a
// national one (dropping its trunk 0, as UK and EU numbers are written).
export function normalizePhone(raw, defaultCountryCode = "1") {
  if (!raw) return "";
  const text = String(raw).trim();
  const digits = text.replace(/\D/g, "");
  if (!digits) return "";
  if (text.startsWith("+")) return `+${digits}`;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith("0")) return `+${defaultCountryCode}${digits.slice(1)}`;
  if (digits.length <= 10) return `+${defaultCountryCode}${digits}`;
  return `+${digits}`;
}

export function orderToRow(order, { defaultCountryCode = "1" } = {}) {
  const customer = order.customer ?? {};
  const shipping = order.shipping_address ?? order.billing_address ?? {};
  const items = order.line_items ?? [];
  const name = [customer.first_name, customer.last_name].filter(Boolean).join(" ") || shipping.name || "";
  return {
    order: order.name ?? `#${order.order_number ?? order.id}`,
    created_at: order.created_at ? new Date(order.created_at).toISOString() : "",
    customer: name,
    email: (order.email ?? customer.email ?? "").trim().toLowerCase(),
    phone: normalizePhone(order.phone ?? customer.phone ?? shipping.phone, defaultCountryCode),
    items: items.map((item) => `${item.quantity} x ${item.title}${item.variant_title ? ` (${item.variant_title})` : ""}`).join("; "),
    item_count: items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0),
    total: Number(order.current_total_price ?? order.total_price ?? 0).toFixed(2),
    currency: order.currency ?? "",
    city: shipping.city ?? "",
    country: shipping.country_code ?? shipping.country ?? "",
    payment: order.financial_status ?? "",
  };
}

export function rowValues(row) {
  return COLUMNS.map((column) => row[column]);
}
