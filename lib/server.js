// The three tools Chord's teammate calls: get_menu, create_payment_link, check_payment.
// Every result is JSON with ok, a status or code, a customer_message the agent can pass on,
// and a next_step telling the agent what to do. Only check_payment status PAID confirms an order.
import { randomBytes } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MENU, ZONES, MAX_QTY, formatNaira, priceOrder } from './menu.js';
import { placeholderEmail } from './paystack.js';

export function log(event, fields = {}) {
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...fields }));
}

const PAYSTACK_DOWN_CODES = new Set(['PAYSTACK_TIMEOUT', 'PAYSTACK_UNREACHABLE', 'PAYSTACK_EMPTY_RESPONSE', 'PAYSTACK_BAD_RESPONSE', 'PAYSTACK_ERROR', 'CONFIG_MISSING_PAYSTACK_KEY', 'LIVE_KEY_REFUSED']);

function paystackProblem(code, reference) {
  return {
    ok: false,
    code,
    ...(reference ? { reference } : {}),
    customer_message: "Sorry, our payment system isn't responding right now. Please give me a moment.",
    next_step: 'Retry this tool once. If it fails again, apologise, tell the customer a staff member will follow up, and hand off to a human. Never confirm the order.',
  };
}

export function getMenu() {
  const menu = MENU.map((i) => ({ ...i, price_display: formatNaira(i.price_ngn) }));
  const delivery_zones = ZONES.map((z) => ({ id: z.id, label: z.label, fee_ngn: z.fee_ngn, fee_display: formatNaira(z.fee_ngn), window: z.window }));
  const lines = menu.filter((i) => i.available).map((i) => `• ${i.name}: ${i.price_display}`);
  const sold = menu.filter((i) => !i.available).map((i) => i.name);
  return {
    ok: true,
    menu,
    delivery_zones,
    customer_message: `Today's menu:\n${lines.join('\n')}${sold.length ? `\nSold out today: ${sold.join(', ')}` : ''}`,
    next_step: 'Show the available items and prices. Ask what they would like, how many, and whether it is delivery or pickup.',
  };
}

const PRICING_GUIDANCE = {
  SOLD_OUT: ['Sorry, that one is sold out today.', 'Suggest a similar available dish and ask what they would like instead. Do not send a link.'],
  UNKNOWN_ITEM: ["I couldn't find that on today's menu.", 'Ask what they meant, using get_menu item names. Do not send a link.'],
  BAD_QUANTITY: [`Quantities must be between 1 and ${MAX_QTY} per item.`, `Fix the quantity with the customer. For more than ${MAX_QTY} of an item or event orders, say the owner will call them and do not send a link.`],
  UNKNOWN_DELIVERY_ZONE: [`Sorry, we don't deliver there yet. We cover ${ZONES.filter((z) => z.id !== 'pickup').map((z) => z.label).join('; ')}, or you can pick up in Yaba.`, 'List the covered areas and offer pickup.'],
  ADDRESS_REQUIRED: ['Please send your full delivery address.', 'Ask for the full address, then call create_payment_link again.'],
};

function newReference(now = new Date()) {
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Array.from(randomBytes(6), (b) => '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'[b % 36]).join('');
  return `MTK-${ymd}-${rand}`;
}

export async function createPaymentLink(input, { paystack, emailDomain = 'example.com', log: logFn = log }) {
  const { customer_name, items, delivery_zone, delivery_address, phone, email, notes } = input ?? {};
  const priced = priceOrder({ items, delivery_zone, delivery_address });
  if (!priced.ok) {
    logFn('create_payment_link.rejected', { code: priced.code });
    const [customer_message, next_step] = PRICING_GUIDANCE[priced.code];
    return { ok: false, code: priced.code, detail: priced.detail, customer_message, next_step };
  }

  const reference = newReference();
  const isPickup = priced.zone.id === 'pickup';
  const metadata = {
    customer_name: customer_name ?? null,
    phone: phone ?? null,
    items: priced.lines,
    delivery_zone: priced.zone.id,
    delivery_address: isPickup ? null : delivery_address.trim(),
    notes: notes ?? null,
    expected_total_kobo: priced.total_kobo,
  };
  const r = await paystack.initialize({
    email: email && /.+@.+\..+/.test(email) ? email : placeholderEmail(phone, emailDomain),
    amount_kobo: priced.total_kobo,
    reference,
    metadata,
  });
  if (!r.ok) {
    logFn('create_payment_link.paystack_error', { code: r.code, http_status: r.http_status });
    return paystackProblem(r.code);
  }
  logFn('create_payment_link.created', { reference, total_kobo: priced.total_kobo });

  const itemsText = priced.lines.map((l) => `${l.quantity} × ${l.name}`).join(', ');
  const feeText = isPickup ? 'pickup' : `delivery ${formatNaira(priced.delivery_fee_ngn)}`;
  return {
    ok: true,
    reference,
    payment_url: r.data.authorization_url,
    lines: priced.lines,
    subtotal: priced.subtotal_ngn,
    delivery_fee: priced.delivery_fee_ngn,
    total: priced.total_ngn,
    total_display: priced.total_display,
    customer_message: `${itemsText} + ${feeText} = ${priced.total_display}.\nPay here (card, transfer or USSD): ${r.data.authorization_url}\nReference: ${reference}\nReply "paid" once you're done.`,
    next_step: 'Send customer_message as is. When the customer says they paid (or sends a screenshot), call check_payment with this reference. Do not confirm before check_payment returns PAID.',
  };
}

function parseMetadata(m) {
  if (typeof m === 'string') {
    try { return JSON.parse(m); } catch { return null; }
  }
  return m && typeof m === 'object' ? m : null;
}

export async function checkPayment(input, { paystack, log: logFn = log }) {
  const reference = String(input?.reference ?? '').trim().toUpperCase();
  const result = (status, customer_message, next_step, extra = {}) => ({ ok: true, status, reference, ...extra, customer_message, next_step });
  if (!reference) {
    return result('UNKNOWN_REFERENCE', "I couldn't find that payment reference.", 'Use the MTK-… reference from create_payment_link earlier in this chat and call check_payment again.');
  }

  const r = await paystack.verify(reference);
  if (!r.ok) {
    logFn('check_payment.paystack_error', { reference, code: r.code, http_status: r.http_status });
    if (r.code === 'UNKNOWN_REFERENCE') {
      return result('UNKNOWN_REFERENCE', "I couldn't find that payment reference.", 'Use the MTK-… reference from create_payment_link earlier in this chat and call check_payment again. Never confirm on a screenshot.');
    }
    return paystackProblem(r.code, reference);
  }

  const tx = r.data;
  const meta = parseMetadata(tx.metadata);
  const amount_display = formatNaira((tx.amount ?? 0) / 100);
  let status;
  switch (tx.status) {
    case 'success': {
      const expected = meta?.expected_total_kobo;
      status = Number.isInteger(expected) && tx.amount === expected && tx.currency === 'NGN' ? 'PAID' : 'AMOUNT_MISMATCH';
      break;
    }
    case 'failed': status = 'FAILED'; break;
    case 'reversed': status = 'REVERSED'; break;
    case 'ongoing': case 'pending': case 'processing': case 'queued': status = 'PENDING'; break;
    default: status = 'NOT_PAID_YET';
  }
  logFn('check_payment.result', { reference, status, paystack_status: tx.status });

  if (status === 'PAID') {
    const zone = ZONES.find((z) => z.id === meta.delivery_zone);
    const itemsText = (meta.items ?? []).map((l) => `${l.quantity} × ${l.name}`).join(', ');
    const when = zone?.id === 'pickup' ? `Ready for pickup in ${zone.window.replace('ready in ', '')} at Herbert Macaulay Way, Yaba.` : `Delivery in ${zone?.window ?? 'the usual window'}.`;
    return result('PAID', `Payment received, your order is confirmed ✅\n${itemsText}\nReference: ${reference}\n${when}`, 'Send customer_message. The order is confirmed and paid.', { amount_display });
  }
  const guidance = {
    AMOUNT_MISMATCH: ["Thanks! The amount on this payment doesn't match your order, so Mama Tolu's team will check it and get back to you shortly.", 'Do not confirm. Tell the customer the owner will follow up; hand off to a human.'],
    FAILED: [`That payment didn't go through${tx.gateway_response ? ` (${tx.gateway_response})` : ''}. You can try again with the same link.`, 'Offer a retry with the same payment link. If this is the second failure in this chat, say a staff member will follow up with a transfer option and hand off.'],
    REVERSED: ['This payment was reversed, so Mama Tolu\'s team will contact you about it.', 'Do not confirm. Hand off to the owner.'],
    PENDING: ['Your payment is still processing. Give it a minute and I\'ll check again.', 'Wait for the customer to reply, then call check_payment again with the same reference.'],
    NOT_PAID_YET: ["I can't see a payment on this order yet. Here's your link again if you need it.", 'Re-send the same payment link kindly. A screenshot is not proof; only PAID confirms.'],
  }[status];
  return result(status, guidance[0], guidance[1], { amount_display, ...(status === 'FAILED' ? { reason: tx.gateway_response ?? null } : {}) });
}

const asText = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });

export function createMcpServer(deps) {
  const server = new McpServer({ name: 'mama-tolu-kitchen', version: '1.0.0' });

  server.registerTool('get_menu', {
    description: "Get Mama Tolu's Kitchen menu (with prices in NGN and sold-out flags) and delivery zones with fees and windows. Call this before quoting anything.",
    inputSchema: {},
  }, async () => asText(getMenu()));

  server.registerTool('create_payment_link', {
    description: 'Validate and price an order on the server, then create a Paystack payment link for it. Only call after the customer has agreed to the read-back order.',
    inputSchema: {
      customer_name: z.string().min(1).describe('Name for the order'),
      items: z.array(z.object({ item_id: z.string().describe('Menu item id from get_menu, e.g. jollof-chicken'), quantity: z.union([z.number(), z.string()]).describe('Whole number, 1 to 20') })).min(1),
      delivery_zone: z.string().describe('Zone id from get_menu (yaba, surulere, ikeja, lekki, pickup) or an area name like Akoka'),
      delivery_address: z.string().optional().describe('Full address; required unless pickup'),
      phone: z.string().optional(),
      email: z.string().optional(),
      notes: z.string().optional(),
    },
  }, async (args) => asText(await createPaymentLink(args, deps)));

  server.registerTool('check_payment', {
    description: 'Ask Paystack whether an order has been paid. The order is confirmed only if status is PAID. Call whenever the customer says they paid or sends a screenshot.',
    inputSchema: { reference: z.string().describe('The MTK-… reference from create_payment_link') },
  }, async (args) => asText(await checkPayment(args, deps)));

  return server;
}
