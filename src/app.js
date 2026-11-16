import express from "express";
import { pool } from "./db/pool.js";

export const app = express();

app.use(express.json());

app.get('/health', async(req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({statsu: 'ok', db: 'up'});
    } catch(err) {
        console.log('Health check gagal:', err.message);
        res.status(503).json({
            status: 'error',
            db: 'down'
        });
    }
});