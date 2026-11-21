import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db/pool.js';
import { expireOrders } from '../src/services/orders.js';
import {
  api, setupDb, resetDb, closeDb, makeUser, makeEvent,
  order, pay, expireNow, checkInvariants,
} from './helpers.js';

const hook = (eventId, orderId, status = 'paid') =>
  api.post('/webhooks/payment').send({ eventId, orderId, status });

async function ticketCount() {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM tickets');
  return rows[0].n;
}

describe('webhook pembayaran', () => {
  before(setupDb);
  beforeEach(resetDb);
  after(closeDb);

  it('pesan yang sama terkirim dua kali: tiket terbit sekali', async () => {
    const buyer = await makeUser();
    const { reguler } = await makeEvent();
    const o = await order(buyer, reguler.id, 2).expect(201);

    const first = await hook('evt-1', o.body.id).expect(200);
    assert.equal(first.body.outcome, 'PAID_NOW');

    const second = await hook('evt-1', o.body.id).expect(200);
    assert.equal(second.body.duplicate, true);

    assert.equal(await ticketCount(), 2);
    await checkInvariants();
  });

  it('dua pesan identik bersamaan: tiket tetap terbit sekali', async () => {
    const buyer = await makeUser();
    const { reguler } = await makeEvent();
    const o = await order(buyer, reguler.id, 2).expect(201);

    await Promise.all([hook('evt-2', o.body.id).expect(200), hook('evt-2', o.body.id).expect(200)]);

    assert.equal(await ticketCount(), 2);
    await checkInvariants();
  });

  it('webhook setelah pesanan sudah lunas lewat /pay: tidak ada tiket tambahan', async () => {
    const buyer = await makeUser();
    const { reguler } = await makeEvent();
    const o = await order(buyer, reguler.id, 2).expect(201);
    await pay(buyer, o.body.id).expect(200);

    const res = await hook('evt-3', o.body.id).expect(200);
    assert.equal(res.body.outcome, 'ALREADY_PAID');
    assert.equal(await ticketCount(), 2);
    await checkInvariants();
  });

  it('webhook tiba setelah kedaluwarsa: tiket tidak terbit', async () => {
    const buyer = await makeUser();
    const { reguler } = await makeEvent();
    const o = await order(buyer, reguler.id, 2).expect(201);

    await expireNow(o.body.id);
    await expireOrders();

    const res = await hook('evt-4', o.body.id).expect(200);
    assert.equal(res.body.outcome, 'LATE');
    assert.equal(await ticketCount(), 0);
    await checkInvariants();
  });

  it('pesanan tidak dikenal dicatat, input salah ditolak', async () => {
    const res = await hook('evt-5', 999999).expect(200);
    assert.equal(res.body.outcome, 'NOT_FOUND');
    await api.post('/webhooks/payment').send({ orderId: 1, status: 'paid' }).expect(400);
    await api.post('/webhooks/payment').send({ eventId: 'x', orderId: 1, status: 'aneh' }).expect(400);
  });
});