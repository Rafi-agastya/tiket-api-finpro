import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db/pool.js';
import { expireOrders } from '../src/services/orders.js';
import {
  api, setupDb, resetDb, closeDb, makeUser, makeEvent,
  order, pay, cancel, remaining, expireNow, checkInvariants,
} from './helpers.js';

describe('pemesanan tiket', () => {
  before(setupDb);
  beforeEach(resetDb);
  after(closeDb);

  it('alur lengkap: pesan, bayar, tiket terbit', async () => {
    const buyer = await makeUser();
    const { event, reguler } = await makeEvent();

    const created = await order(buyer, reguler.id, 2).expect(201);
    assert.equal(created.body.status, 'PENDING');
    assert.equal(created.body.totalPrice, 200000);
    assert.equal(await remaining(event.id, 'Reguler'), 98);

    const paid = await pay(buyer, created.body.id).expect(200);
    assert.equal(paid.body.status, 'PAID');
    assert.equal(paid.body.tickets.length, 2);
    for (const t of paid.body.tickets) {
      assert.match(t.code, /^TKT-[0-9A-F]{12}$/);
    }
    assert.equal(new Set(paid.body.tickets.map((t) => t.code)).size, 2);

    const history = await api.get('/orders').set('X-Buyer-Id', String(buyer.id)).expect(200);
    assert.equal(history.body.length, 1);
    assert.equal(history.body[0].tickets.length, 2);

    await checkInvariants();
  });

  it('membayar dua kali tidak menerbitkan tiket dua kali', async () => {
    const buyer = await makeUser();
    const { reguler } = await makeEvent();
    const created = await order(buyer, reguler.id, 2).expect(201);

    const first = await pay(buyer, created.body.id).expect(200);
    const second = await pay(buyer, created.body.id).expect(200);

    assert.deepEqual(second.body.tickets, first.body.tickets);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM tickets');
    assert.equal(rows[0].n, 2);
    await checkInvariants();
  });

  it('kuota habis: pesanan melebihi sisa ditolak, tidak ada oversell', async () => {
    const { event, reguler } = await makeEvent({ reguler: 5 });
    const a = await makeUser('A');
    const b = await makeUser('B');
    const c = await makeUser('C');

    await order(a, reguler.id, 3).expect(201);
    await order(b, reguler.id, 3).expect(409);
    assert.equal(await remaining(event.id, 'Reguler'), 2);

    await order(b, reguler.id, 2).expect(201);
    assert.equal(await remaining(event.id, 'Reguler'), 0);
    await order(c, reguler.id, 1).expect(409);

    await checkInvariants();
  });

  it('batas 4 tiket per pembeli per event, berlaku lintas tipe', async () => {
    const buyer = await makeUser();
    const { reguler, vip } = await makeEvent();

    const first = await order(buyer, reguler.id, 3).expect(201);
    await order(buyer, reguler.id, 2).expect(422);
    await order(buyer, vip.id, 2).expect(422);
    await order(buyer, vip.id, 1).expect(201);
    await order(buyer, reguler.id, 1).expect(422);

    await cancel(buyer, first.body.id).expect(200);
    await order(buyer, reguler.id, 3).expect(201);

    await checkInvariants();
  });

  it('batal mengembalikan kuota tepat sekali', async () => {
    const buyer = await makeUser();
    const { event, reguler } = await makeEvent();
    const created = await order(buyer, reguler.id, 2).expect(201);
    assert.equal(await remaining(event.id, 'Reguler'), 98);

    await cancel(buyer, created.body.id).expect(200);
    assert.equal(await remaining(event.id, 'Reguler'), 100);

    const again = await cancel(buyer, created.body.id).expect(200);
    assert.equal(again.body.status, 'CANCELLED');
    assert.equal(await remaining(event.id, 'Reguler'), 100);

    await pay(buyer, created.body.id).expect(409);
    await checkInvariants();
  });

  it('pesanan kedaluwarsa: tidak bisa dibayar dan kuota kembali', async () => {
    const buyer1 = await makeUser('Satu');
    const buyer2 = await makeUser('Dua');
    const { event, reguler } = await makeEvent();

    const o1 = await order(buyer1, reguler.id, 2).expect(201);
    const o2 = await order(buyer2, reguler.id, 1).expect(201);
    await pay(buyer2, o2.body.id).expect(200);

    await expireNow(o1.body.id);
    await expireNow(o2.body.id);

    await pay(buyer1, o1.body.id).expect(409);
    assert.equal(await expireOrders(), 1);
    assert.equal(await expireOrders(), 0);

    const detail1 = await api.get(`/orders/${o1.body.id}`).set('X-Buyer-Id', String(buyer1.id)).expect(200);
    const detail2 = await api.get(`/orders/${o2.body.id}`).set('X-Buyer-Id', String(buyer2.id)).expect(200);
    assert.equal(detail1.body.status, 'EXPIRED');
    assert.equal(detail2.body.status, 'PAID');
    assert.equal(await remaining(event.id, 'Reguler'), 99);

    await checkInvariants();
  });

  it('menolak input salah dan pesanan milik orang lain', async () => {
    const buyer = await makeUser('Pemilik');
    const other = await makeUser('Orang Lain');
    const { reguler } = await makeEvent();

    await api.post('/orders').send({ ticketTypeId: reguler.id, qty: 1 }).expect(401);
    await order(buyer, reguler.id, 5).expect(400);
    await order(buyer, reguler.id, 0).expect(400);
    await order(buyer, 999999, 1).expect(404);

    const created = await order(buyer, reguler.id, 1).expect(201);
    await pay(other, created.body.id).expect(404);
    await api.get(`/orders/${created.body.id}`).set('X-Buyer-Id', String(other.id)).expect(404);

    await checkInvariants();
  });
});