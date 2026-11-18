import { app } from './app.js';
import { migrate } from './db/migrate.js';

const port = process.env.PORT || 3000;

await migrate();

app.listen(port, (err) => {
  if (err) {
    console.error('Gagal membuka port', port, '-', err.message);
    process.exit(1);
  }
  console.log(`API jalan di http://localhost:${port}`);
});