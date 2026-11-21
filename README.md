# API Penjualan Tiket Event (Kuota Terbatas)

Backend untuk menjual tiket event dengan kuota terbatas. Dibangun dengan Node.js 24, Express 5, dan PostgreSQL 16. Pembayaran disimulasikan, dengan dua cara menandainya lunas: endpoint langsung dan webhook.

## Menjalankan (satu perintah)

Syarat: Docker dan Docker Compose.

```bash
docker compose up --build
```

API tersedia di `http://localhost:3000`. Migrasi database berjalan otomatis saat API start. Cek dengan `GET /health`.

Untuk berhenti: `docker compose down`. Untuk menghapus data juga: `docker compose down -v`.

### Memakai image dari registry

Setiap push menghasilkan image bertag commit di GitHub Container Registry:

```
ghcr.io/rafi-agastya/tiket-api-finpro:sha-<7 karakter commit>
ghcr.io/rafi-agastya/tiket-api-finpro:latest
```

## Mencoba alur lengkap

Contoh berikut memakai file di `samples/` dan mengasumsikan database baru (`docker compose down -v` lalu `up`), sehingga tipe tiket Reguler berid `1`, VIP berid `2`, dan pesanan pertama berid `1`. Kalau databasenya sudah berisi data, ambil id dari respons masing-masing langkah. Di Windows PowerShell, gunakan `curl.exe`, bukan `curl`.

```bash
# 1. Buat event (Reguler kuota 100, VIP kuota 20)
curl -X POST http://localhost:3000/events -H "Content-Type: application/json" --data "@samples/event-valid.json"

# 2. Buat pembeli (dapat id 1)
curl -X POST http://localhost:3000/users -H "Content-Type: application/json" --data "@samples/user.json"

# 3. Pesan 2 tiket Reguler (status PENDING, menahan kuota 15 menit)
curl -X POST http://localhost:3000/orders -H "Content-Type: application/json" -H "X-Buyer-Id: 1" --data "@samples/order-reguler-2.json"

# 4. Tandai lunas (simulasi pembayaran), tiket terbit.
#    Pilih SALAH SATU: langsung lewat endpoint...
curl -X POST http://localhost:3000/orders/1/pay -H "X-Buyer-Id: 1"
#    ...atau lewat webhook seperti penyedia sungguhan
curl -X POST http://localhost:3000/webhooks/payment -H "Content-Type: application/json" --data "@samples/webhook-paid.json"

# 5. Lihat riwayat pesanan dan tiket
curl http://localhost:3000/orders -H "X-Buyer-Id: 1"
```

## Cara menandai pesanan lunas

Ada dua cara, dan keduanya berujung pada logika pelunasan yang sama.

**1. Endpoint langsung**

```
POST /orders/:id/pay      (header X-Buyer-Id: <id pembeli>)
```

Hanya pesanan berstatus `PENDING` yang belum lewat 15 menit yang bisa dilunasi. Memanggil endpoint ini dua kali aman: tiket tidak diterbitkan ulang dan responsnya sama.

**2. Webhook** (lihat bagian "Webhook pembayaran" di bawah)

```
POST /webhooks/payment
```

## Webhook pembayaran (idempoten)

Hasil pembayaran juga bisa diterima lewat webhook seperti penyedia sungguhan:

```bash
curl -X POST http://localhost:3000/webhooks/payment -H "Content-Type: application/json" --data "@samples/webhook-paid.json"
```

Body: `{ "eventId": "<id unik pesan>", "orderId": 1, "status": "paid" }`. Nilai `status` yang diterima: `paid` atau `failed`. Hasil (`outcome`) dan perilakunya:

| Kondisi | Hasil |
|---|---|
| Pesanan `PENDING`, belum lewat waktu | `PAID_NOW`, tiket terbit |
| `eventId` yang sama dikirim lagi | `duplicate: true`, diabaikan |
| Pesanan sudah lunas | `ALREADY_PAID`, tidak ada tiket baru |
| Pesanan sudah kedaluwarsa atau dibatalkan | `LATE`, tidak ada tiket |
| Pesanan tidak dikenal | `NOT_FOUND`, dicatat |

Endpoint membalas 200 untuk semua kondisi bisnis di atas, dan 400 hanya untuk body yang salah bentuk. Setiap `eventId` hanya diproses satu kali, jadi untuk mencoba ulang dengan pesanan lain, ganti `eventId` pada `samples/webhook-paid.json`.

## Endpoint

| Method | Path | Keterangan |
|---|---|---|
| GET | `/health` | Cek API dan database |
| POST | `/events` | Buat event beserta tipe Reguler dan VIP (kuota dan harga masing-masing) |
| GET | `/events`, `/events/:id` | Lihat event dan sisa kuota per tipe |
| POST | `/users` | Buat pembeli |
| POST | `/orders` | Pesan 1 sampai 4 tiket. Body: `{ "ticketTypeId": 1, "qty": 2 }` |
| GET | `/orders`, `/orders/:id` | Riwayat pesanan beserta tiketnya |
| POST | `/orders/:id/pay` | Tandai lunas dan terbitkan tiket |
| POST | `/orders/:id/cancel` | Batalkan sebelum bayar, kuota langsung kembali |
| POST | `/webhooks/payment` | Terima hasil pembayaran dari penyedia (idempoten) |

Semua endpoint `/orders` memerlukan header `X-Buyer-Id`. Identifikasi pembeli ini sengaja sederhana (otentikasi tidak dinilai).

Kode status: `400` input salah, `401` pembeli tidak dikenal, `404` tidak ditemukan, `409` kuota habis atau status tidak mengizinkan, `422` melewati batas 4 tiket per event.

## Menjalankan test

Syarat: Node.js 24 dan database container berjalan.

```bash
docker compose up -d db
npm ci
npm test
```

Test memakai database terpisah `tiket_test` (dibuat otomatis oleh `docker/initdb`). Test menolak berjalan jika nama database tidak berakhiran `_test`. Ada 12 test integrasi (HTTP dan PostgreSQL sungguhan), dengan skenario:

- alur pesan, bayar, sampai tiket terbit
- bayar dua kali tidak menerbitkan tiket dua kali
- kuota habis, tidak ada oversell
- batas 4 tiket per pembeli per event (lintas tipe)
- batal mengembalikan kuota tepat sekali
- pesanan kedaluwarsa tidak bisa dibayar dan kuotanya kembali
- validasi input dan pesanan milik orang lain
- webhook yang sama terkirim dua kali, atau dua pesan identik bersamaan, tidak menerbitkan tiket dua kali
- webhook untuk pesanan yang sudah lunas, kedaluwarsa, atau tidak dikenal ditangani tanpa efek samping

Setiap test diakhiri pemeriksaan invarian: jumlah kuota yang ditahan sama dengan jumlah tiket pada pesanan aktif, dan tiket hanya ada untuk pesanan lunas sebanyak jumlah pesanannya.

## Uji 200 pesanan bersamaan

```bash
docker compose up --build -d
npm run loadtest
```

Skrip membuat event berkuota 100, lalu mengirim 200 pesanan sekaligus dari 200 pembeli berbeda. Hasil yang kami peroleh:

```
201 Created  : 100
409 Conflict : 100
Lainnya      : 0
Sisa kuota   : 0
Waktu        : 400 ms

HASIL: LULUS (tepat 100 terjual, tidak ada oversell)
```

Pemeriksaan langsung di database setelahnya: `quota = 100`, `held = 100`.

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`) pada setiap push:

1. Menjalankan test dengan PostgreSQL sungguhan.
2. Jika lolos, membangun image Docker dan mengunggahnya ke `ghcr.io` dengan tag `sha-<commit>` (dan `latest` untuk branch `main`).

Jika test gagal, image tidak dibuat.

## Konfigurasi

Lihat `.env.example`. Hanya `DATABASE_URL` dan `PORT` yang perlu untuk menjalankan lokal tanpa Docker (`npm run dev`).

| Variabel | Bawaan | Keterangan |
|---|---|---|
| `PORT` | 3000 | Port API |
| `DATABASE_URL` | - | Connection string PostgreSQL |
| `ORDER_TTL_SECONDS` | 900 | Lama pesanan menahan kuota (15 menit) |
| `SWEEP_INTERVAL_SECONDS` | 15 | Jeda pembatalan otomatis pesanan kedaluwarsa |

## Struktur

```
src/        routes/ (HTTP), services/ (logika bisnis), db/, jobs/ (sweeper), middleware/
migrations/ file SQL berurutan (001 skema utama, 002 tabel webhook)
test/       test integrasi
scripts/    uji konkurensi
samples/    contoh body request
docker/     skrip inisialisasi database
```

Keputusan desain dan trade-off ada di [DECISIONS.md](DECISIONS.md).

Catatan: proyek ini tidak menyertakan frontend (opsional pada soal).