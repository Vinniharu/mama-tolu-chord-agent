import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startFakePaystack } from '../dev/fake-paystack.js';
import { createLocalServer } from '../dev/local-server.js';

const TOKEN = 'test-token-123';
let fake, server, base;
before(async () => {
  fake = await startFakePaystack();
  process.env.MCP_AUTH_TOKEN = TOKEN;
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_' + 'a1'.repeat(20);
  process.env.PAYSTACK_BASE_URL = fake.url;
  server = createLocalServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); await fake.close(); });

const rpc = (method, params = {}, token = TOKEN) => fetch(`${base}/mcp`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
});
const initParams = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } };

test('GET /mcp is 405', async () => {
  assert.equal((await fetch(`${base}/mcp`, { headers: { Authorization: `Bearer ${TOKEN}` } })).status, 405);
});

test('POST without a token is 401', async () => {
  assert.equal((await rpc('initialize', initParams, null)).status, 401);
});

test('POST with a wrong token is 401', async () => {
  assert.equal((await rpc('initialize', initParams, 'nope')).status, 401);
});

test('initialize returns the server name', async () => {
  const res = await rpc('initialize', initParams);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).result.serverInfo.name, 'mama-tolu-kitchen');
});

test('tools/list returns the three tools', async () => {
  const body = await (await rpc('tools/list')).json();
  assert.deepEqual(body.result.tools.map((t) => t.name).sort(), ['check_payment', 'create_payment_link', 'get_menu']);
});

test('tools/call create_payment_link then check_payment works end to end', async () => {
  const call = async (name, args) => JSON.parse((await (await rpc('tools/call', { name, arguments: args })).json()).result.content[0].text);
  const link = await call('create_payment_link', { customer_name: 'Ada', items: [{ item_id: 'jollof-chicken', quantity: 2 }, { item_id: 'zobo', quantity: '2' }], delivery_zone: 'yaba', delivery_address: '12 Akoka Rd' });
  assert.equal(link.total_display, '₦11,200');
  assert.equal((await call('check_payment', { reference: link.reference })).status, 'NOT_PAID_YET');
});

test('missing MCP_AUTH_TOKEN on the server is a 500 config error', async () => {
  delete process.env.MCP_AUTH_TOKEN;
  try {
    const res = await rpc('initialize', initParams);
    assert.equal(res.status, 500);
    assert.equal((await res.json()).code, 'CONFIG_MISSING_AUTH_TOKEN');
  } finally {
    process.env.MCP_AUTH_TOKEN = TOKEN;
  }
});

test('GET /health reports a test key without exposing it', async () => {
  const res = await fetch(`${base}/health`);
  const body = await res.json();
  assert.deepEqual(body, { ok: true, service: 'mama-tolu-mcp', paystack_key: 'test' });
});

test('GET /health flags a placeholder key like "sk_test_..."', async () => {
  const saved = process.env.PAYSTACK_SECRET_KEY;
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_...';
  try {
    assert.equal((await (await fetch(`${base}/health`)).json()).paystack_key, 'placeholder');
  } finally {
    process.env.PAYSTACK_SECRET_KEY = saved;
  }
});
