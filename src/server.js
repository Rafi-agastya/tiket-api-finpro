import { app } from './app.js';
import { pool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { startSweeper } from './jobs/sweeper.js';

const port = process.env.PORT || 3000;

await migrate();

let stopSweeper = () => {};

const server = app.listen(port, (err) => {
  if (err) {
    console.error('Gagal membuka port', port, '-', err.message);
    process.exit(1);
  }
  console.log(`API jalan di http://localhost:${port}`);
  stopSweeper = startSweeper();
});

function shutdown(signal) {
  console.log(`${signal} diterima, mematikan server...`);
  stopSweeper();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));