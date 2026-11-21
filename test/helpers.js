import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

export const api = request(app);

function assertTestDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL tidak ditemukan. Jalankan lewat npm test.');
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith('_test')) {
    throw new Error(`Test menolak berjalan di database "${dbName}". Nama harus berakhiran _test.`);
  }
}

export async function setupDb() {
  assertTestDb();
  await migrate();
}

export async function resetDb() {
  assertTestDb();
  await pool.query(
    'TRUNCATE tickets, orders, ticket_types, events, users, payment_events RESTART IDENTITY CASCADE',
  );
}

export async function closeDb() {
  await pool.end();
}

export async function makeUser(name = 'Pembeli') {
  const res = await api.post('/users').send({ name }).expect(201);
  return res.body;
}

export async function makeEvent({ reguler = 100, vip = 20 } = {}) {
  const res = await api
    .post('/events')
    .send({
      name: 'Event Tes',
      startsAt: '2030-01-01T10:00:00+07:00',
      ticketTypes: [
        { name: 'Reguler', price: 100000, quota: reguler },
        { name: 'VIP', price: 250000, quota: vip },
      ],
    })
    .expect(201);
  const byName = Object.fromEntries(res.body.ticketTypes.map((t) => [t.name, t]));
  return { event: res.body, reguler: byName.Reguler, vip: byName.VIP };
}

export const order = (buyer, ticketTypeId, qty) =>
  api.post('/orders').set('X-Buyer-Id', String(buyer.id)).send({ ticketTypeId, qty });

export const pay = (buyer, orderId) =>
  api.post(`/orders/${orderId}/pay`).set('X-Buyer-Id', String(buyer.id));

export const cancel = (buyer, orderId) =>
  api.post(`/orders/${orderId}/cancel`).set('X-Buyer-Id', String(buyer.id));

export async function remaining(eventId, typeName) {
  const res = await api.get(`/events/${eventId}`).expect(200);
  return res.body.ticketTypes.find((t) => t.name === typeName).remaining;
}

export async function expireNow(orderId) {
  await pool.query(
    "UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id = $1",
    [orderId],
  );
}

export async function checkInvariants() {
  const { rows: kuota } = await pool.query(`
    SELECT tt.id, tt.held,
           COALESCE(SUM(o.qty) FILTER (WHERE o.status IN ('PENDING','PAID')), 0) AS dari_pesanan
      FROM ticket_types tt
      LEFT JOIN orders o ON o.ticket_type_id = tt.id
     GROUP BY tt.id`);
  for (const r of kuota) {
    assert.equal(r.held, r.dari_pesanan, `held tipe ${r.id} tidak sama dengan jumlah pesanan aktif`);
  }

  const { rows: tiket } = await pool.query(`
    SELECT o.id, o.status, o.qty, count(t.id) AS jumlah_tiket
      FROM orders o
      LEFT JOIN tickets t ON t.order_id = o.id
     GROUP BY o.id`);
  for (const r of tiket) {
    const harapan = r.status === 'PAID' ? r.qty : 0;
    assert.equal(r.jumlah_tiket, harapan, `pesanan ${r.id} (${r.status}) punya jumlah tiket salah`);
  }
}