import { expireOrders } from '../services/orders.js';
import { SWEEP_INTERVAL_SECONDS, EXPIRE_BATCH_SIZE } from '../config.js';

export function startSweeper() {
  let running = false;

  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      let n;
      do {
        n = await expireOrders();
        if (n > 0) console.log(`Sweeper: ${n} pesanan kedaluwarsa`);
      } while (n === EXPIRE_BATCH_SIZE);
    } catch (err) {
      console.error('Sweeper gagal:', err.message);
    } finally {
      running = false;
    }
  }, SWEEP_INTERVAL_SECONDS * 1000);

  timer.unref();
  return () => clearInterval(timer);
}