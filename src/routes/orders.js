import { Router } from 'express';
import { requireBuyer } from '../middleware/buyer.js';
import { createOrder } from '../services/orders.js';

export const ordersRouter = Router();

ordersRouter.use(requireBuyer);

ordersRouter.post('/', async (req, res) => {
  res.status(201).json(await createOrder(req.buyer.id, req.body));
});