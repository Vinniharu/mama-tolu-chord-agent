import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MENU, ZONES, MAX_QTY, formatNaira, resolveZone, priceOrder } from '../lib/menu.js';

const demo = (overrides = {}) => ({
  items: [{ item_id: 'jollof-chicken', quantity: 2 }, { item_id: 'zobo', quantity: 2 }],
  delivery_zone: 'yaba',
  delivery_address: '12 Akoka Rd',
  ...overrides,
});

test('menu has the 10 brief items with ofada sold out', () => {
  assert.equal(MENU.length, 10);
  assert.equal(MENU.find((i) => i.id === 'ofada-sauce').available, false);
  assert.equal(MENU.find((i) => i.id === 'pounded-egusi').price_ngn, 5500);
  assert.equal(ZONES.find((z) => z.id === 'lekki').fee_ngn, 3500);
  assert.equal(MAX_QTY, 20);
});

test('formatNaira uses ₦ and comma thousands', () => {
  assert.equal(formatNaira(11200), '₦11,200');
  assert.equal(formatNaira(700), '₦700');
});

test('prices the demo order', () => {
  const r = priceOrder(demo());
  assert.equal(r.ok, true);
  assert.equal(r.subtotal_ngn, 10200);
  assert.equal(r.delivery_fee_ngn, 1000);
  assert.equal(r.total_ngn, 11200);
  assert.equal(r.total_kobo, 1120000);
  assert.equal(r.total_display, '₦11,200');
  assert.deepEqual(r.lines[0], { item_id: 'jollof-chicken', name: 'Jollof rice + fried chicken', quantity: 2, unit_price_ngn: 4500, line_total_ngn: 9000 });
  assert.equal(r.zone.id, 'yaba');
});

test('sold out item is refused', () => {
  const r = priceOrder({ items: [{ item_id: 'ofada-sauce', quantity: 1 }], delivery_zone: 'pickup' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'SOLD_OUT');
});

test('unknown item is refused', () => {
  assert.equal(priceOrder({ items: [{ item_id: 'shawarma', quantity: 1 }], delivery_zone: 'pickup' }).code, 'UNKNOWN_ITEM');
});

test('quantity 0, 21, 1.5 and "abc" are BAD_QUANTITY', () => {
  for (const quantity of [0, 21, 1.5, 'abc', -1]) {
    assert.equal(priceOrder(demo({ items: [{ item_id: 'zobo', quantity }] })).code, 'BAD_QUANTITY', `qty ${quantity}`);
  }
});

test('numeric string quantity is accepted', () => {
  assert.equal(priceOrder(demo({ items: [{ item_id: 'zobo', quantity: '2' }] })).lines[0].quantity, 2);
});

test('empty items is BAD_QUANTITY', () => {
  assert.equal(priceOrder(demo({ items: [] })).code, 'BAD_QUANTITY');
});

test('duplicate lines merge and the limit applies to the merged quantity', () => {
  const r = priceOrder(demo({ items: [{ item_id: 'jollof-chicken', quantity: 1 }, { item_id: 'jollof-chicken', quantity: 2 }] }));
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].quantity, 3);
  const over = priceOrder(demo({ items: [{ item_id: 'jollof-chicken', quantity: 15 }, { item_id: 'jollof-chicken', quantity: 6 }] }));
  assert.equal(over.code, 'BAD_QUANTITY');
});

test('area names resolve to zones', () => {
  assert.equal(resolveZone(' Akoka ').id, 'yaba');
  assert.equal(resolveZone('VI').id, 'lekki');
  assert.equal(resolveZone('SURULERE').id, 'surulere');
  assert.equal(resolveZone('Ikeja').id, 'ikeja');
  assert.equal(resolveZone('pickup').id, 'pickup');
  assert.equal(resolveZone('abuja'), null);
  assert.equal(priceOrder(demo({ delivery_zone: 'Akoka' })).zone.id, 'yaba');
});

test('unknown zone is refused', () => {
  assert.equal(priceOrder(demo({ delivery_zone: 'abuja' })).code, 'UNKNOWN_DELIVERY_ZONE');
});

test('address required for delivery but not pickup', () => {
  assert.equal(priceOrder(demo({ delivery_address: '' })).code, 'ADDRESS_REQUIRED');
  assert.equal(priceOrder(demo({ delivery_address: '   ' })).code, 'ADDRESS_REQUIRED');
  const p = priceOrder(demo({ delivery_zone: 'pickup', delivery_address: undefined }));
  assert.equal(p.ok, true);
  assert.equal(p.delivery_fee_ngn, 0);
});
