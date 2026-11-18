export const ORDER_TTL_SECONDS = Number(process.env.ORDER_TTL_SECONDS ?? 900);  
export const SWEEP_INTERVAL_SECONDS = Number(process.env.SWEEP_INTERVAL_SECONDS ?? 15);
export const EXPIRE_BATCH_SIZE = 100;