const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const TOTAL = Number(process.env.TOTAL ?? 200);
const QUOTA = Number(process.env.QUOTA ?? 100);

async function call(method, path, { body, buyerId } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(buyerId ? { 'X-Buyer-Id': String(buyerId) } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

// 1. Siapkan event dengan kuota Reguler = QUOTA
const created = await call('POST', '/events', {
  body: {
    name: `Uji Konkurensi ${new Date().toISOString()}`,
    startsAt: '2030-01-01T10:00:00+07:00',
    ticketTypes: [
      { name: 'Reguler', price: 100000, quota: QUOTA },
      { name: 'VIP', price: 250000, quota: 10 },
    ],
  },
});
if (created.status !== 201) {
  console.error('Gagal membuat event:', created.status, created.data);
  process.exit(1);
}
const event = created.data;
const reguler = event.ticketTypes.find((t) => t.name === 'Reguler');

// 2. Siapkan TOTAL pembeli berbeda
const users = await Promise.all(
  Array.from({ length: TOTAL }, (_, i) =>
    call('POST', '/users', { body: { name: `Pembeli ${i + 1}` } }),
  ),
);
const buyerIds = users.map((u) => u.data.id);

// 3. Tembak semua pesanan SEKALIGUS
console.log(`Mengirim ${TOTAL} pesanan bersamaan untuk kuota ${QUOTA}...`);
const t0 = performance.now();
const results = await Promise.all(
  buyerIds.map((id) =>
    call('POST', '/orders', { buyerId: id, body: { ticketTypeId: reguler.id, qty: 1 } }),
  ),
);
const ms = Math.round(performance.now() - t0);

// 4. Hitung hasil
const berhasil = results.filter((r) => r.status === 201).length;
const ditolak = results.filter((r) => r.status === 409).length;
const lainnya = results.length - berhasil - ditolak;

const detail = await call('GET', `/events/${event.id}`);
const sisa = detail.data.ticketTypes.find((t) => t.name === 'Reguler').remaining;

console.log('');
console.log(`201 Created  : ${berhasil}`);
console.log(`409 Conflict : ${ditolak}`);
console.log(`Lainnya      : ${lainnya}`);
console.log(`Sisa kuota   : ${sisa}`);
console.log(`Waktu        : ${ms} ms`);

const lulus = berhasil === QUOTA && ditolak === TOTAL - QUOTA && lainnya === 0 && sisa === 0;
console.log(`\nHASIL: ${lulus ? 'LULUS (tepat ' + QUOTA + ' terjual, tidak ada oversell)' : 'GAGAL'}`);
process.exitCode = lulus ? 0 : 1;