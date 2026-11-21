import pg from 'pg';

pg.types.setTypeParser(20, (value) => Number.parseInt(value, 10));

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  connectionTimeoutMillis: 10000,
});