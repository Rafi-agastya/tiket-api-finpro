import { pool } from '../db/pool.js';
import { HttpError } from '../errors.js';

export async function createUser(body) {
  const name = body?.name;
  if (typeof name !== 'string' || name.trim() === '') {
    throw new HttpError(400, 'name wajib diisi');
  }
  const { rows } = await pool.query(
    'INSERT INTO users (name) VALUES ($1) RETURNING id, name',
    [name.trim()],
  );
  return rows[0];
}

export async function findUser(id) {
  const { rows } = await pool.query('SELECT id, name FROM users WHERE id = $1', [id]);
  return rows[0] ?? null;
}