import express from 'express';
import { pool } from './db/pool.js';
import { eventsRouter } from './routes/events.js';
import { HttpError } from './errors.js';

export const app = express();

app.use(express.json());

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'up' });
  } catch (err) {
    console.error('Health check gagal:', err.message);
    res.status(503).json({ status: 'error', db: 'down' });
  }
});

app.use('/events', eventsRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Rute tidak ditemukan' });
});

app.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Body bukan JSON yang valid' });
  }
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan pada server' });
});