import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getMenu, createPaymentLink, checkPayment } from '../lib/server.js';
import { createPaystackClient } from '../lib/paystack.js';
import { startFakePaystack } from '../dev/fake-paystack.js';

let fake, deps;
const logs = [];
before(async () => {
  fake = await startFakePaystack();
  deps = { paystack: createPaystackClient({ secretKey: 'sk_test_fake', baseUrl: fake.url }), emailDomain: 'example.com', log: (e, f) => logs.push([e, f]) };
});
after(() => fake.close());
beforeEach(() => { fake.state.mode = 'ok'; fake.state.calls = 0; });

const demoOrder = {
  customer_name: 'Ada', phone: '+234 801 234 5678',
  items: [{ item_id: 'jollof-chicken', quantity: 2 }, { item_id: 'zobo', quantity: 2 }],
  delivery_zone: 'Akoka', delivery_address: '12 Akoka Rd',
};
const newPaidLink = async () => (await createPaymentLink(demoOrder, deps)).reference;
const setTx = (ref, patch) => Object.assign(fake.state.transactions.get(ref), patch);

test('getMenu lists items, marks ofada unavailable and lists zones', () => {
  const r = getMenu();
  assert.equal(r.ok, true);
  assert.equal(r.menu.find((i) => i.id === 'ofada-sauce').available, false);
  assert.equal(r.menu.find((i) => i.id === 'jollof-chicken').price_display, '₦4,500');
  assert.equal(r.delivery_zones.length, 5);
  assert.ok(r.customer_message && r.next_step);
});

test('createPaymentLink prices on the server and sends kobo to Paystack', async () => {
  const r = await createPaymentLink(demoOrder, deps);
  assert.equal(r.ok, true);
  assert.match(r.reference, /^MTK-\d{8}-[0-9A-Z]{6}$/);
  assert.match(r.payment_url, /^http/);
  assert.equal(r.total_display, '₦11,200');
  assert.equal(r.delivery_fee, 1000);
  assert.equal(fake.state.lastBody.amount, 1120000);
  assert.equal(fake.state.lastBody.email, 'wa-2348012345678@example.com');
  assert.equal(fake.state.lastBody.metadata.expected_total_kobo, 1120000);
  assert.equal(fake.state.lastBody.metadata.delivery_zone, 'yaba');
  assert.equal(fake.state.lastBody.metadata.items[0].item_id, 'jollof-chicken');
  assert.ok(r.customer_message.includes(r.payment_url));
  assert.ok(r.customer_message.includes('₦11,200'));
});

test('createPaymentLink uses the customer email when given', async () => {
  await createPaymentLink({ ...demoOrder, email: 'ada@mail.test' }, deps);
  assert.equal(fake.state.lastBody.email, 'ada@mail.test');
});

test('sold out makes no Paystack call', async () => {
  const r = await createPaymentLink({ ...demoOrder, items: [{ item_id: 'ofada-sauce', quantity: 1 }] }, deps);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'SOLD_OUT');
  assert.equal(fake.state.calls, 0);
  assert.ok(r.customer_message && r.next_step);
});

test('Paystack failure on create is passed through as a code', async () => {
  fake.state.mode = '500';
  const r = await createPaymentLink(demoOrder, deps);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'PAYSTACK_ERROR');
});

const statusCases = [
  ['abandoned', 'NOT_PAID_YET'],
  ['ongoing', 'PENDING'], ['pending', 'PENDING'], ['processing', 'PENDING'], ['queued', 'PENDING'],
  ['failed', 'FAILED'],
  ['reversed', 'REVERSED'],
  ['success', 'PAID'],
];
for (const [paystackStatus, expected] of statusCases) {
  test(`paystack "${paystackStatus}" maps to ${expected}`, async () => {
    const ref = await newPaidLink();
    setTx(ref, { status: paystackStatus, gateway_response: 'Declined' });
    const r = await checkPayment({ reference: ref }, deps);
    assert.equal(r.status, expected);
    assert.equal(r.reference, ref);
    assert.ok(r.customer_message && r.next_step);
  });
}

test('FAILED carries the gateway reason', async () => {
  const ref = await newPaidLink();
  setTx(ref, { status: 'failed', gateway_response: 'Declined' });
  assert.equal((await checkPayment({ reference: ref }, deps)).reason, 'Declined');
});

test('success one kobo short is AMOUNT_MISMATCH', async () => {
  const ref = await newPaidLink();
  setTx(ref, { status: 'success', amount: 1119999 });
  assert.equal((await checkPayment({ reference: ref }, deps)).status, 'AMOUNT_MISMATCH');
});

test('success in USD is AMOUNT_MISMATCH', async () => {
  const ref = await newPaidLink();
  setTx(ref, { status: 'success', currency: 'USD' });
  assert.equal((await checkPayment({ reference: ref }, deps)).status, 'AMOUNT_MISMATCH');
});

test('success without expected total in metadata is AMOUNT_MISMATCH', async () => {
  const ref = await newPaidLink();
  setTx(ref, { status: 'success', metadata: { customer_name: 'Ada' } });
  assert.equal((await checkPayment({ reference: ref }, deps)).status, 'AMOUNT_MISMATCH');
  setTx(ref, { metadata: null });
  assert.equal((await checkPayment({ reference: ref }, deps)).status, 'AMOUNT_MISMATCH');
});

test('metadata as a JSON string still verifies as PAID', async () => {
  const ref = await newPaidLink();
  const tx = fake.state.transactions.get(ref);
  setTx(ref, { status: 'success', metadata: JSON.stringify(tx.metadata) });
  assert.equal((await checkPayment({ reference: ref }, deps)).status, 'PAID');
});

test('reference is trimmed and uppercased', async () => {
  const ref = await newPaidLink();
  setTx(ref, { status: 'success' });
  const r = await checkPayment({ reference: `  ${ref.toLowerCase()} ` }, deps);
  assert.equal(r.status, 'PAID');
  assert.equal(r.reference, ref);
});

test('unknown reference is UNKNOWN_REFERENCE', async () => {
  const r = await checkPayment({ reference: 'MTK-20261120-ZZZZZZ' }, deps);
  assert.equal(r.status, 'UNKNOWN_REFERENCE');
});

test('Paystack down on check passes the code through, not paid', async () => {
  fake.state.mode = 'garbled';
  const r = await checkPayment({ reference: 'MTK-20261120-ZZZZZZ' }, deps);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'PAYSTACK_BAD_RESPONSE');
  assert.notEqual(r.status, 'PAID');
});

test('only PAID results say the order is confirmed', async () => {
  const ref = await newPaidLink();
  for (const s of ['abandoned', 'pending', 'failed', 'reversed']) {
    setTx(ref, { status: s });
    const r = await checkPayment({ reference: ref }, deps);
    assert.doesNotMatch(r.customer_message, /confirmed/i, s);
  }
  setTx(ref, { status: 'success' });
  assert.match((await checkPayment({ reference: ref }, deps)).customer_message, /confirmed/i);
});

test('logs never contain the secret key', () => {
  assert.ok(logs.length > 0);
  assert.ok(!JSON.stringify(logs).includes('sk_test_fake'));
});
