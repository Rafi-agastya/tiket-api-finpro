import { withTransaction } from '../db/tx.js';
import { HttpError } from '../errors.js';
import { markPaidBySystem } from './orders.js';

export async function handlePaymentWebhook(body) {
  const { eventId, orderId, status } = body ?? {};

  if (typeof eventId !== 'string' || eventId.trim() === '') {
    throw new HttpError(400, 'eventId wajib diisi');
  }
  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    throw new HttpError(400, 'orderId harus bilangan bulat positif');
  }
  if (!['paid', 'failed'].includes(status)) {
    throw new HttpError(400, "status harus 'paid' atau 'failed'");
  }

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO payment_events (provider_event_id, order_id, status, payload)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (provider_event_id) DO NOTHING
       RETURNING id`,
      [eventId, orderId, status, JSON.stringify(body)],
    );

    if (rows.length === 0) {
      return { received: true, duplicate: true };
    }

    const outcome =
      status === 'paid' ? await markPaidBySystem(client, orderId) : 'FAILED_NOTED';

    await client.query('UPDATE payment_events SET outcome = $1 WHERE id = $2', [
      outcome,
      rows[0].id,
    ]);
    return { received: true, duplicate: false, outcome };
  });
}