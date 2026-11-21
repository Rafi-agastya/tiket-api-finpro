# Keputusan Desain dan Trade-off

## 1. Menjaga kuota tetap benar (inti sistem)

**Keputusan.** Setiap tipe tiket punya kolom `quota` dan `held` (jumlah yang sedang ditahan oleh pesanan `PENDING` dan `PAID`). Sisa kuota = `quota - held`. Memesan dilakukan dengan satu pernyataan:

```sql
UPDATE ticket_types SET held = held + $qty
 WHERE id = $id AND held + $qty <= quota
```

Jika tidak ada baris yang terpengaruh, kuota tidak cukup dan pesanan ditolak (409).

**Alasan.** Pola "baca sisa, cek, lalu ubah" rawan race condition: dua request membaca sisa 1, keduanya lolos, dan tiket terjual dua kali. Dengan satu `UPDATE` bersyarat, PostgreSQL mengunci baris tersebut sehingga request yang datang bersamaan antre dan kondisinya dinilai ulang dengan nilai terbaru.

**Lapisan kedua.** Constraint `CHECK (held >= 0 AND held <= quota)` di database. Kalau kode aplikasi punya bug, database tetap menolak oversell.

**Alternatif yang dipertimbangkan.**
- `SELECT ... FOR UPDATE` lalu hitung `COUNT` pesanan: benar, tapi lebih lambat dan lebih banyak langkah.
- Menghitung sisa dari tabel pesanan setiap kali: tidak ada angka yang bisa tidak sinkron, tapi query membesar seiring jumlah pesanan.
- Redis atau antrean: menambah infrastruktur yang tidak diperlukan untuk skala soal ini.

**Yang dikorbankan.** `held` adalah data turunan: harus selalu diperbarui bersama perubahan status pesanan. Itu dijaga dengan melakukannya dalam transaksi yang sama, dan diuji oleh pemeriksaan invarian di setiap test.

**Bukti.** 200 pesanan bersamaan untuk kuota 100 berakhir dengan tepat 100 terjual dan 100 ditolak (lihat README).

## 2. Batas 4 tiket per pembeli per event

**Keputusan.** Sebelum menahan kuota, transaksi mengambil `pg_advisory_xact_lock` berdasarkan kombinasi (event, pembeli), lalu menghitung jumlah tiket pada pesanan `PENDING` dan `PAID` milik pembeli itu di event tersebut.

**Alasan.** Batas ini dihitung dari banyak baris pesanan, jadi tidak bisa dijaga oleh satu `UPDATE`. Tanpa kunci, dua request paralel dari pembeli yang sama (masing-masing 3 tiket) sama-sama menghitung "sudah punya 0" dan keduanya lolos, sehingga totalnya 6. Kunci hanya mengantrikan request pembeli yang sama di event yang sama, pembeli lain tetap berjalan paralel. Kunci dilepas otomatis saat transaksi selesai.

**Yang dikorbankan.** Request beruntun dari pembeli yang sama diproses satu per satu (wajar). Dua kombinasi berbeda secara teori bisa memakai nomor kunci yang sama (tabrakan hash), akibatnya hanya menunggu sedikit lebih lama, bukan hasil yang salah. Batas berlaku per event, bukan per tipe tiket.

## 3. Kedaluwarsa 15 menit

**Keputusan.** Dua lapis:
1. Saat membayar, kondisi `expires_at > now()` menolak pesanan yang sudah lewat waktu, bahkan jika belum disapu.
2. Sweeper di dalam proses API berjalan tiap 15 detik, mengubah pesanan `PENDING` yang sudah lewat waktu menjadi `EXPIRED`, dan mengembalikan kuotanya dalam transaksi yang sama. Memakai `FOR UPDATE SKIP LOCKED` sehingga aman jika ada lebih dari satu instance.

**Alasan.** Lapisan pertama menjamin kebenaran (pembayaran terlambat tidak pernah lolos), lapisan kedua menjamin kuota akhirnya kembali. Waktu memakai `now()` milik database, bukan jam server aplikasi, sehingga konsisten.

**Alternatif.** Timer per pesanan di memori hilang saat server restart. Penjadwal terpisah (cron atau antrean pekerjaan) menambah infrastruktur. Mengandalkan pengecekan saat dibaca saja membuat `held` tidak akurat.

**Yang dikorbankan.** Kuota pesanan kedaluwarsa bisa tertahan hingga sekitar 15 detik setelah batas waktu. Dalam rentang itu pesanan tersebut juga masih dihitung pada batas 4 tiket. Itu kompromi sederhana yang diterima.

## 4. Siklus status dan idempotensi

**Keputusan.** Status pesanan: `PENDING` menjadi `PAID`, `CANCELLED`, atau `EXPIRED`. Semua perpindahan memakai pola `UPDATE ... WHERE status = 'PENDING'` dan hanya perpindahan yang berhasil yang menjalankan efek sampingnya (menerbitkan tiket atau mengembalikan kuota).

**Alasan.** Jika bayar dan batal, atau bayar dan sweeper, bertabrakan, hanya satu yang menang. Yang kalah melihat status sudah berubah. Karena itu kuota kembali tepat sekali, dan tiket terbit tepat sekali.

**Idempoten.** Membayar pesanan yang sudah lunas membalas 200 dengan tiket yang sama. Membatalkan pesanan yang sudah batal juga membalas 200. Klien aman mengulang request jika koneksi putus. Jalur webhook (bagian 10) memakai pola status yang sama, jadi pesan pembayaran yang datang berulang atau terlambat tidak bisa menerbitkan tiket dua kali.

**Pengaman tambahan.** `UNIQUE (order_id, seq)` dan `UNIQUE (code)` di tabel tiket mencegah tiket ganda walau ada bug. Penerbitan tiket dan perubahan status berada dalam satu transaksi, jadi tidak mungkin ada pesanan lunas tanpa tiket.

## 5. PostgreSQL dan SQL langsung (tanpa ORM)

PostgreSQL dipilih karena punya transaksi, penguncian baris, dan constraint yang menjadi dasar penjagaan kuota. SQL ditulis langsung dengan driver `pg` supaya logika kuota terlihat jelas dan bisa dijelaskan, tidak tersembunyi di balik ORM. Nilai selalu dikirim sebagai parameter (`$1`, `$2`) sehingga aman dari SQL injection. Biayanya: lebih banyak kode manual dan tidak ada pemeriksaan tipe otomatis.

## 6. Penyederhanaan yang disengaja

- **Satu pesanan satu tipe tiket.** Pembeli yang ingin Reguler dan VIP membuat dua pesanan. Menghindari tabel item pesanan. Batas 4 tiket tetap dihitung lintas tipe.
- **Identitas pembeli seadanya** lewat header `X-Buyer-Id`. Siapa pun bisa berpura-pura menjadi pembeli lain. Otentikasi tidak dinilai pada soal ini.
- **Pembayaran disimulasikan** lewat `POST /orders/:id/pay` atau webhook. Pembayaran setelah kedaluwarsa ditolak dan tidak ada konsep refund.
- **Konsistensi event dan tipe tiket pada pesanan** dijaga di kode, bukan constraint database.
- **Kode tiket** berupa 6 byte acak (48 bit). Peluang bentrok sangat kecil, dan constraint `UNIQUE` menolaknya jika terjadi.

## 7. Pool koneksi

Pool dinaikkan menjadi maksimum 20 koneksi dengan batas tunggu 10 detik. Dengan bawaan (10 koneksi dan 3 detik), pada lonjakan 200 request sebagian bisa gagal karena kehabisan waktu menunggu koneksi, padahal logikanya benar. Antre sebentar dipilih daripada gagal cepat.

## 8. Docker dan CI/CD

- Migrasi berjalan otomatis saat API start, dilindungi advisory lock sehingga dua instance tidak bermigrasi bersamaan. Hasilnya satu perintah (`docker compose up --build`) cukup untuk menyalakan seluruh sistem.
- API menunggu database sehat sebelum start (`depends_on` dengan `service_healthy`).
- Image ditag dengan commit (`sha-xxxxxxx`) supaya jelas versi mana yang berjalan, `latest` hanya alias tambahan. Image hanya dibuat jika test lolos (`needs: test`).
- Test integrasi memakai PostgreSQL sungguhan, bukan mock, karena yang paling rawan salah adalah perilaku database. Test menolak berjalan di database yang namanya tidak berakhiran `_test`.

## 9. Tidak dikerjakan

- **Frontend** tidak dikerjakan karena keterbatasan waktu (opsional pada soal).
- Daftar event belum dipaginasi. Sweeper berjalan dalam proses API (cukup untuk skala ini, dan aman untuk beberapa instance berkat `SKIP LOCKED`, namun belum diuji dengan banyak instance).

## 10. Webhook pembayaran idempoten

**Keputusan.** `POST /webhooks/payment` mencatat setiap pesan di tabel `payment_events` dengan `provider_event_id` yang `UNIQUE`, memakai `INSERT ... ON CONFLICT DO NOTHING`. Pesan dengan ID yang sudah ada diabaikan (200, `duplicate: true`). Pesan baru dijalankan lewat logika pelunasan yang sama dengan `/pay`, dalam satu transaksi dengan pencatatannya.

**Tiga skenario.**
- *Terkirim dua kali:* ID yang sama dikenali dan diabaikan. Untuk dua pesan identik yang datang bersamaan, `INSERT` kedua menunggu transaksi pertama selesai, lalu mendapat konflik. Jadi constraint `UNIQUE` melindungi dari pengulangan sekaligus dari balapan.
- *Terlambat (pesanan sudah lunas):* `UPDATE ... WHERE status = 'PENDING'` tidak mengubah apa pun, tiket tidak terbit lagi (`ALREADY_PAID`).
- *Tiba setelah kedaluwarsa:* `expires_at > now()` dan status `EXPIRED` menolak, kejadian dicatat dengan hasil `LATE` untuk ditindaklanjuti manual.

**Selalu membalas 200** untuk kondisi bisnis (duplikat, terlambat, tidak dikenal), karena penyedia pembayaran sungguhan mengirim ulang terus-menerus jika menerima status error. Hanya input yang salah bentuk yang dibalas 400.

**Yang dikorbankan.** Keaslian pengirim tidak diverifikasi (penyedia sungguhan menandatangani pesan, misalnya dengan HMAC). Tidak ada proses refund otomatis untuk hasil `LATE`. Logika pelunasan ditulis ulang di `markPaidBySystem` dan belum dipakai bersama oleh `payOrder`, supaya `payOrder` yang sudah teruji tidak diubah.

**Bukti.** Lima test otomatis (`test/webhook.test.js`) memeriksa pesan ganda, dua pesan identik bersamaan, webhook setelah pesanan lunas, webhook setelah kedaluwarsa, dan pesanan tidak dikenal.