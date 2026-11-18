import { withTransaction } from '../db/tx.js';
import { HttpError } from '../errors.js';
import { ORDER_TTL_SECONDS } from '../config.js';

const MAX_PER_EVENT = 4;

function toOrderDto(o) {
  return {
    id: o.id,
    eventId: o.event_id,
    ticketTypeId: o.ticket_type_id,
    qty: o.qty,
    totalPrice: o.total_price,
    status: o.status,
    expiresAt: o.expires_at,
    createdAt: o.created_at,
  };
}

export async function createOrder(buyerId, body) {
  const { ticketTypeId, qty } = body ?? {};

  if (!Number.isSafeInteger(ticketTypeId) || ticketTypeId <= 0) {
    throw new HttpError(400, 'ticketTypeId harus bilangan bulat positif');
  }
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_PER_EVENT) {
    throw new HttpError(400, `qty harus bilangan bulat 1 sampai ${MAX_PER_EVENT}`);
  }

  return withTransaction(async (client) => {
    // 1. Cari tipe tiketnya: butuh event_id dan harga
    const { rows: types } = await client.query(
      'SELECT id, event_id, price FROM ticket_types WHERE id = $1',
      [ticketTypeId],
    );
    if (types.length === 0) {
      throw new HttpError(404, 'Tipe tiket tidak ditemukan');
    }
    const type = types[0];

    // 2. Antrikan request pembeli yang sama di event yang sama
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
      [`${type.event_id}:${buyerId}`],
    );

    // 3. Hitung tiket aktif milik pembeli di event ini
    const { rows: [{ total: aktif }] } = await client.query(
      `SELECT COALESCE(SUM(qty), 0) AS total
         FROM orders
        WHERE buyer_id = $1 AND event_id = $2
          AND status IN ('PENDING', 'PAID')`,
      [buyerId, type.event_id],
    );
    if (aktif + qty > MAX_PER_EVENT) {
      throw new HttpError(
        422,
        `Maksimal ${MAX_PER_EVENT} tiket per event. Kamu sudah punya ${aktif}, sisa jatah ${MAX_PER_EVENT - aktif}`,
      );
    }

    // 4. Ambil kuota secara atomik: cek dan ubah dalam SATU pernyataan
    const { rowCount } = await client.query(
      `UPDATE ticket_types
          SET held = held + $1
        WHERE id = $2 AND held + $1 <= quota`,
      [qty, ticketTypeId],
    );
    if (rowCount === 0) {
      throw new HttpError(409, 'Kuota tiket tidak mencukupi');
    }

    // 5. Catat pesanan
    const { rows } = await client.query(
      `INSERT INTO orders
         (buyer_id, event_id, ticket_type_id, qty, total_price, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'PENDING', now() + make_interval(secs => $6))
       RETURNING *`,
      [buyerId, type.event_id, ticketTypeId, qty, type.price * qty, ORDER_TTL_SECONDS],
    );
    return toOrderDto(rows[0]);
  });
}