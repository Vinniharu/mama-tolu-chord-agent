import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPaystackClient, placeholderEmail } from '../lib/paystack.js';
import { startFakePaystack } from '../dev/fake-paystack.js';

let fake;
before(async () => { fake = await startFakePaystack(); });
after(() => fake.close());

const client = (opts = {}) => createPaystackClient({ secretKey: 'sk_test_fake', baseUrl: fake.url, ...opts });
const init = (c = client()) => c.initialize({ email: 'a@example.com', amount_kobo: 1120000, reference: 'MTK-TEST-1', metadata: { expected_total_kobo: 1120000 } });

test('initialize returns the checkout url and sends the bearer key and kobo amount', async () => {
  fake.state.mode = 'ok';
  const r = await init();
  assert.equal(r.ok, true);
  assert.match(r.data.authorization_url, /^https?:\/\//);
  assert.equal(r.data.reference, 'MTK-TEST-1');
  assert.equal(fake.state.lastAuth, 'Bearer sk_test_fake');
  assert.equal(fake.state.lastBody.amount, 1120000);
  assert.equal(fake.state.lastBody.currency, 'NGN');
});

test('verify returns the transaction for a known reference', async () => {
  fake.state.mode = 'ok';
  await init();
  const r = await client().verify('MTK-TEST-1');
  assert.equal(r.ok, true);
  assert.equal(r.data.status, 'abandoned');
  assert.equal(r.data.amount, 1120000);
});

test('verify on an unknown reference is UNKNOWN_REFERENCE', async () => {
  fake.state.mode = 'ok';
  const r = await client().verify('MTK-NOPE');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'UNKNOWN_REFERENCE');
});

test('paystack 500 is PAYSTACK_ERROR with the http status', async () => {
  fake.state.mode = '500';
  const r = await client().verify('MTK-TEST-1');
  assert.equal(r.code, 'PAYSTACK_ERROR');
  assert.equal(r.http_status, 500);
});

test('empty body is PAYSTACK_EMPTY_RESPONSE', async () => {
  fake.state.mode = 'empty';
  assert.equal((await client().verify('MTK-TEST-1')).code, 'PAYSTACK_EMPTY_RESPONSE');
});

test('garbled body is PAYSTACK_BAD_RESPONSE', async () => {
  fake.state.mode = 'garbled';
  assert.equal((await client().verify('MTK-TEST-1')).code, 'PAYSTACK_BAD_RESPONSE');
});

test('slow paystack is PAYSTACK_TIMEOUT', async () => {
  fake.state.mode = 'slow';
  assert.equal((await client({ timeoutMs: 200 }).verify('MTK-TEST-1')).code, 'PAYSTACK_TIMEOUT');
});

test('unreachable paystack is PAYSTACK_UNREACHABLE', async () => {
  assert.equal((await client({ baseUrl: 'http://127.0.0.1:1' }).verify('X')).code, 'PAYSTACK_UNREACHABLE');
});

test('missing key and live key are refused before any call', async () => {
  fake.state.mode = 'ok';
  fake.state.calls = 0;
  assert.equal((await client({ secretKey: '' }).verify('X')).code, 'CONFIG_MISSING_PAYSTACK_KEY');
  assert.equal((await client({ secretKey: undefined }).verify('X')).code, 'CONFIG_MISSING_PAYSTACK_KEY');
  assert.equal((await init(client({ secretKey: 'sk_live_abc' }))).code, 'LIVE_KEY_REFUSED');
  assert.equal(fake.state.calls, 0);
});

test('placeholderEmail uses phone digits or a guest id', () => {
  assert.equal(placeholderEmail('+234 801 234 5678'), 'wa-2348012345678@example.com');
  assert.equal(placeholderEmail('08012345678', 'orders.test'), 'wa-08012345678@orders.test');
  assert.match(placeholderEmail(undefined), /^wa-guest-[a-z0-9]+@example\.com$/);
});
