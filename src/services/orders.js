import { randomBytes } from 'node:crypto';
import { pool } from '../db/pool.js';
import { withTransaction } from '../db/tx.js';
import { HttpError } from '../errors.js';
import { ORDER_TTL_SECONDS, EXPIRE_BATCH_SIZE } from '../config.js';


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

function generateTicketCode() {
  return `TKT-${randomBytes(6).toString('hex').toUpperCase()}`;
}

async function findOwnOrder(client, buyerId, orderId) {
  const { rows } = await client.query(
    'SELECT * FROM orders WHERE id = $1 AND buyer_id = $2',
    [orderId, buyerId],
  );
  if (rows.length === 0) {
    throw new HttpError(404, 'Pesanan tidak ditemukan');
  }
  return rows[0];
}

const SELECT_ORDER_DETAIL = `
  SELECT o.*, e.name AS event_name, tt.name AS ticket_type_name
    FROM orders o
    JOIN events e ON e.id = o.event_id
    JOIN ticket_types tt ON tt.id = o.ticket_type_id`;

async function loadTickets(orderIds) {
  const { rows } = await pool.query(
    `SELECT order_id, seq, code FROM tickets
      WHERE order_id = ANY($1::bigint[])
      ORDER BY order_id, seq`,
    [orderIds],
  );
  return rows;
}

function toDetailDto(o, tickets) {
  return {
    ...toOrderDto(o),
    paidAt: o.paid_at,
    eventName: o.event_name,
    ticketTypeName: o.ticket_type_name,
    tickets: tickets.map((t) => ({ seq: t.seq, code: t.code })),
  };
}

export async function getOrder(buyerId, orderId) {
  const { rows } = await pool.query(
    `${SELECT_ORDER_DETAIL} WHERE o.id = $1 AND o.buyer_id = $2`,
    [orderId, buyerId],
  );
  if (rows.length === 0) {
    throw new HttpError(404, 'Pesanan tidak ditemukan');
  }
  return toDetailDto(rows[0], await loadTickets([orderId]));
}

export async function listOrders(buyerId) {
  const { rows } = await pool.query(
    `${SELECT_ORDER_DETAIL}
      WHERE o.buyer_id = $1
      ORDER BY o.created_at DESC, o.id DESC`,
    [buyerId],
  );
  const tickets = await loadTickets(rows.map((r) => r.id));
  return rows.map((o) => toDetailDto(o, tickets.filter((t) => t.order_id === o.id)));
}

const ALASAN_TIDAK_BISA_BAYAR = {
  CANCELLED: 'Pesanan sudah dibatalkan',
  EXPIRED: 'Pesanan sudah kedaluwarsa',
  PENDING: 'Batas waktu pembayaran sudah lewat',
};

export async function payOrder(buyerId, orderId) {
  await withTransaction(async (client) => {
    // Hanya pesanan PENDING yang belum lewat waktu yang boleh jadi PAID
    const { rows } = await client.query(
      `UPDATE orders
          SET status = 'PAID', paid_at = now()
        WHERE id = $1 AND buyer_id = $2
          AND status = 'PENDING' AND expires_at > now()
        RETURNING qty`,
      [orderId, buyerId],
    );

    if (rows.length === 1) {
      for (let seq = 1; seq <= rows[0].qty; seq++) {
        await client.query(
          'INSERT INTO tickets (order_id, seq, code) VALUES ($1, $2, $3)',
          [orderId, seq, generateTicketCode()],
        );
      }
      return;
    }

    // 0 baris: cari tahu kenapa
    const order = await findOwnOrder(client, buyerId, orderId);
    if (order.status === 'PAID') return; // idempoten: sudah lunas, tidak ada tiket baru
    throw new HttpError(409, ALASAN_TIDAK_BISA_BAYAR[order.status]);
  });

  return getOrder(buyerId, orderId);
}

export async function markPaidBySystem(client, orderId) {
  const { rows } = await client.query(
    `UPDATE orders
        SET status = 'PAID', paid_at = now()
      WHERE id = $1 AND status = 'PENDING' AND expires_at > now()
      RETURNING qty`,
    [orderId],
  );

  if (rows.length === 1) {
    for (let seq = 1; seq <= rows[0].qty; seq++) {
      await client.query(
        'INSERT INTO tickets (order_id, seq, code) VALUES ($1, $2, $3)',
        [orderId, seq, generateTicketCode()],
      );
    }
    return 'PAID_NOW';
  }

  const { rows: current } = await client.query(
    'SELECT status FROM orders WHERE id = $1',
    [orderId],
  );
  if (current.length === 0) return 'NOT_FOUND';
  if (current[0].status === 'PAID') return 'ALREADY_PAID';
  return 'LATE';
}

export async function cancelOrder(buyerId, orderId) {
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE orders
          SET status = 'CANCELLED'
        WHERE id = $1 AND buyer_id = $2 AND status = 'PENDING'
        RETURNING ticket_type_id, qty`,
      [orderId, buyerId],
    );

    if (rows.length === 1) {
      await client.query(
        'UPDATE ticket_types SET held = held - $1 WHERE id = $2',
        [rows[0].qty, rows[0].ticket_type_id],
      );
      return;
    }

    const order = await findOwnOrder(client, buyerId, orderId);
    if (order.status === 'CANCELLED') return; // idempoten: kuota tidak dikembalikan dua kali
    throw new HttpError(
      409,
      order.status === 'PAID'
        ? 'Pesanan sudah dibayar, tidak bisa dibatalkan'
        : 'Pesanan sudah kedaluwarsa',
    );
  });

  return getOrder(buyerId, orderId);
}

export async function expireOrders(limit = EXPIRE_BATCH_SIZE) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE orders
          SET status = 'EXPIRED'
        WHERE id IN (
          SELECT id FROM orders
           WHERE status = 'PENDING' AND expires_at <= now()
           ORDER BY expires_at
           LIMIT $1
           FOR UPDATE SKIP LOCKED
        )
        RETURNING ticket_type_id, qty`,
      [limit],
    );

    // Gabungkan per tipe tiket, lalu kembalikan kuotanya
    const perTipe = new Map();
    for (const { ticket_type_id, qty } of rows) {
      perTipe.set(ticket_type_id, (perTipe.get(ticket_type_id) ?? 0) + qty);
    }
    for (const [typeId, qty] of [...perTipe].sort((a, b) => a[0] - b[0])) {
      await client.query(
        'UPDATE ticket_types SET held = held - $1 WHERE id = $2',
        [qty, typeId],
      );
    }
    return rows.length;
  });
}