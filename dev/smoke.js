// Smoke test against a running server (local or Vercel), speaking MCP JSON-RPC like Chord does.
// Usage: node dev/smoke.js http://localhost:3000   (reads MCP_AUTH_TOKEN from env or .env)
// Creates one real payment link (Paystack test mode on a real server) and checks it is NOT_PAID_YET.
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');
const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const token = process.env.MCP_AUTH_TOKEN;
if (!token) {
  console.error('MCP_AUTH_TOKEN is not set (env or .env).');
  process.exit(2);
}

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
};

let id = 0;
async function rpc(method, params = {}, auth = token) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  const text = await res.text();
  // Accept JSON or a single SSE event, in case the server streams.
  const json = text.startsWith('{') ? JSON.parse(text) : JSON.parse(text.split('\n').find((l) => l.startsWith('data:'))?.slice(5) ?? 'null');
  return { status: res.status, json, requestId: res.headers.get('x-vercel-id') };
}
const tool = async (name, args) => {
  const r = await rpc('tools/call', { name, arguments: args });
  return JSON.parse(r.json?.result?.content?.[0]?.text ?? 'null');
};

try {
  const health = await fetch(`${base}/health`).then((r) => r.json());
  check('health', health.ok === true && health.paystack_key === 'test', `paystack_key=${health.paystack_key}`);

  const noAuth = await rpc('initialize', {}, null);
  check('no token is 401', noAuth.status === 401, `got ${noAuth.status}`);

  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
  check('initialize', init.json?.result?.serverInfo?.name === 'mama-tolu-kitchen', `status ${init.status}${init.requestId ? ` id ${init.requestId}` : ''}`);

  const list = await rpc('tools/list');
  const names = (list.json?.result?.tools ?? []).map((t) => t.name).sort().join(',');
  check('tools/list has 3 tools', names === 'check_payment,create_payment_link,get_menu', names);

  const menu = await tool('get_menu', {});
  check('get_menu', menu?.ok === true && menu.menu.length === 10);

  const link = await tool('create_payment_link', {
    customer_name: 'Smoke Test', phone: '08000000000',
    items: [{ item_id: 'jollof-chicken', quantity: 2 }, { item_id: 'zobo', quantity: 2 }],
    delivery_zone: 'yaba', delivery_address: '1 Smoke Test Rd, Akoka',
  });
  check('create_payment_link', link?.ok === true && link.total_display === '₦11,200', link?.ok ? '' : `code=${link?.code}`);
  if (link?.ok) {
    console.log(`      reference: ${link.reference}\n      pay at:    ${link.payment_url}`);
    const pay = await tool('check_payment', { reference: link.reference });
    check('check_payment is NOT_PAID_YET', pay?.status === 'NOT_PAID_YET', `status=${pay?.status ?? pay?.code}`);
  }
} catch (err) {
  check('smoke run', false, err.message);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
