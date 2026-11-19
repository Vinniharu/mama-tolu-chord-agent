// Mama Tolu's Kitchen menu, delivery zones and server-side pricing.
// Prices live here, in code, so the agent can never quote or charge a made-up amount.
// To change the menu (e.g. mark something sold out), edit MENU and redeploy.

export const MAX_QTY = 20;

export const MENU = [
  { id: 'jollof-chicken', name: 'Jollof rice + fried chicken', price_ngn: 4500, available: true, category: 'main' },
  { id: 'jollof-beef', name: 'Jollof rice + beef', price_ngn: 4000, available: true, category: 'main' },
  { id: 'fried-rice-chicken', name: 'Fried rice + chicken', price_ngn: 4800, available: true, category: 'main' },
  { id: 'amala-ewedu', name: 'Amala, ewedu and gbegiri with assorted meat', price_ngn: 5000, available: true, category: 'main' },
  { id: 'pounded-egusi', name: 'Pounded yam + egusi with goat meat', price_ngn: 5500, available: true, category: 'main' },
  { id: 'ofada-sauce', name: 'Ofada rice + ayamase sauce', price_ngn: 4500, available: false, category: 'main' },
  { id: 'moi-moi', name: 'Moi moi (extra)', price_ngn: 800, available: true, category: 'extra' },
  { id: 'dodo', name: 'Dodo / fried plantain (extra)', price_ngn: 700, available: true, category: 'extra' },
  { id: 'zobo', name: 'Zobo drink, 50cl', price_ngn: 600, available: true, category: 'drink' },
  { id: 'chapman', name: 'Chapman, 50cl', price_ngn: 1200, available: true, category: 'drink' },
];

export const ZONES = [
  { id: 'yaba', label: 'Yaba / Akoka / Sabo', areas: ['yaba', 'akoka', 'sabo'], fee_ngn: 1000, window: '30 to 50 min' },
  { id: 'surulere', label: 'Surulere / Ebute Metta', areas: ['surulere', 'ebute metta', 'ebute-metta'], fee_ngn: 1500, window: '45 to 70 min' },
  { id: 'ikeja', label: 'Ikeja / Maryland / Ojota', areas: ['ikeja', 'maryland', 'ojota'], fee_ngn: 2500, window: '60 to 90 min' },
  { id: 'lekki', label: 'Lekki / VI / Ikoyi', areas: ['lekki', 'vi', 'victoria island', 'ikoyi'], fee_ngn: 3500, window: '75 to 120 min' },
  { id: 'pickup', label: 'Pickup at the kitchen (Herbert Macaulay Way, Yaba)', areas: ['pickup', 'pick up', 'pick-up'], fee_ngn: 0, window: 'ready in 20 to 30 min' },
];

export function formatNaira(n) {
  return '₦' + Math.round(n).toLocaleString('en-US');
}

export function resolveZone(input) {
  if (typeof input !== 'string') return null;
  const key = input.trim().toLowerCase();
  if (!key) return null;
  return ZONES.find((z) => z.id === key || z.areas.includes(key)) ?? null;
}

const fail = (code, detail) => ({ ok: false, code, detail });

export function priceOrder({ items, delivery_zone, delivery_address } = {}) {
  if (!Array.isArray(items) || items.length === 0) return fail('BAD_QUANTITY', 'The order has no items.');

  // Merge duplicate lines first so the per-item limit applies to the total quantity.
  const merged = new Map();
  for (const { item_id, quantity } of items) {
    const item = MENU.find((m) => m.id === item_id);
    if (!item) return fail('UNKNOWN_ITEM', `"${item_id}" is not on the menu.`);
    if (!item.available) return fail('SOLD_OUT', `${item.name} is sold out today.`);
    const qty = typeof quantity === 'string' && quantity.trim() !== '' ? Number(quantity) : quantity;
    if (!Number.isInteger(qty) || qty < 1) return fail('BAD_QUANTITY', `Quantity for ${item.name} must be a whole number from 1 to ${MAX_QTY}.`);
    merged.set(item.id, (merged.get(item.id) ?? 0) + qty);
  }
  for (const [id, qty] of merged) {
    if (qty > MAX_QTY) return fail('BAD_QUANTITY', `${qty} × ${MENU.find((m) => m.id === id).name} is over the ${MAX_QTY} limit; large orders go to the owner.`);
  }

  const zone = resolveZone(delivery_zone);
  if (!zone) return fail('UNKNOWN_DELIVERY_ZONE', `We don't deliver to "${delivery_zone}" yet.`);
  if (zone.id !== 'pickup' && !(typeof delivery_address === 'string' && delivery_address.trim())) {
    return fail('ADDRESS_REQUIRED', 'A delivery address is needed.');
  }

  const lines = [...merged].map(([id, quantity]) => {
    const item = MENU.find((m) => m.id === id);
    return { item_id: id, name: item.name, quantity, unit_price_ngn: item.price_ngn, line_total_ngn: item.price_ngn * quantity };
  });
  const subtotal_ngn = lines.reduce((s, l) => s + l.line_total_ngn, 0);
  const total_ngn = subtotal_ngn + zone.fee_ngn;
  return {
    ok: true,
    lines,
    subtotal_ngn,
    delivery_fee_ngn: zone.fee_ngn,
    total_ngn,
    total_kobo: total_ngn * 100,
    total_display: formatNaira(total_ngn),
    zone,
  };
}
