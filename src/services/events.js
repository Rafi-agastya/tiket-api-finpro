import { pool } from '../db/pool.js';
import { withTransaction } from '../db/tx.js';
import { HttpError } from '../errors.js';

const TIPE_WAJIB = ['Reguler', 'VIP'];

function validateNewEvent(body) {
  const { name, description, venue, startsAt, ticketTypes } = body ?? {};

  if (typeof name !== 'string' || name.trim() === '') {
    throw new HttpError(400, 'name wajib diisi');
  }
  for (const [field, value] of [['description', description], ['venue', venue]]) {
    if (value != null && typeof value !== 'string') {
      throw new HttpError(400, `${field} harus berupa teks`);
    }
  }

  const start = new Date(startsAt);
  if (typeof startsAt !== 'string' || Number.isNaN(start.getTime())) {
    throw new HttpError(400, 'startsAt harus berupa tanggal valid (format ISO 8601)');
  }

  if (
    !Array.isArray(ticketTypes) ||
    ticketTypes.length !== 2 ||
    !TIPE_WAJIB.every((n) => ticketTypes.some((t) => t?.name === n))
  ) {
    throw new HttpError(400, 'ticketTypes harus berisi tepat 2 tipe: Reguler dan VIP');
  }

  for (const t of ticketTypes) {
    if (!Number.isInteger(t.price) || t.price < 0) {
      throw new HttpError(400, `price tipe ${t.name} harus bilangan bulat >= 0`);
    }
    if (!Number.isInteger(t.quota) || t.quota <= 0) {
      throw new HttpError(400, `quota tipe ${t.name} harus bilangan bulat > 0`);
    }
  }

  return {
    name: name.trim(),
    description: description ?? null,
    venue: venue ?? null,
    startsAt: start.toISOString(),
    ticketTypes: ticketTypes.map((t) => ({ name: t.name, price: t.price, quota: t.quota })),
  };
}

export async function createEvent(body) {
  const data = validateNewEvent(body);

  const eventId = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO events (name, description, venue, starts_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [data.name, data.description, data.venue, data.startsAt],
    );
    const id = rows[0].id;

    for (const t of data.ticketTypes) {
      await client.query(
        `INSERT INTO ticket_types (event_id, name, price, quota)
         VALUES ($1, $2, $3, $4)`,
        [id, t.name, t.price, t.quota],
      );
    }
    return id;
  });

  return getEventById(eventId);
}

async function loadTicketTypes(eventIds) {
  const { rows } = await pool.query(
    `SELECT id, event_id, name, price, quota, quota - held AS remaining
       FROM ticket_types
      WHERE event_id = ANY($1::bigint[])
      ORDER BY id`,
    [eventIds],
  );
  return rows;
}

function toEventDto(event, types) {
  return {
    id: event.id,
    name: event.name,
    description: event.description,
    venue: event.venue,
    startsAt: event.starts_at,
    ticketTypes: types.map((t) => ({
      id: t.id,
      name: t.name,
      price: t.price,
      quota: t.quota,
      remaining: t.remaining,
    })),
  };
}

export async function listEvents() {
  const { rows: events } = await pool.query(
    `SELECT id, name, description, venue, starts_at
       FROM events
      ORDER BY starts_at, id`,
  );
  const types = await loadTicketTypes(events.map((e) => e.id));
  return events.map((e) => toEventDto(e, types.filter((t) => t.event_id === e.id)));
}

export async function getEventById(id) {
  const { rows } = await pool.query(
    `SELECT id, name, description, venue, starts_at FROM events WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) {
    throw new HttpError(404, 'Event tidak ditemukan');
  }
  const types = await loadTicketTypes([id]);
  return toEventDto(rows[0], types);
}