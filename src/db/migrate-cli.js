import { migrate } from './migrate.js';
import { pool } from './pool.js';
try{
    await migrate();
} catch(err){
    console.error(err.message);
    process.exitCode = 1;
} finally {
    await pool.end();
}