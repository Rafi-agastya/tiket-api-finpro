import { Router } from 'express';
import { requireBuyer } from '../middleware/buyer.js';
import {
  createOrder,
  listOrders,
  getOrder,
  payOrder,
  cancelOrder,
} from '../services/orders.js';
import { parseId } from '../validate.js';

export const ordersRouter = Router();

ordersRouter.use(requireBuyer);

ordersRouter.post('/', async (req, res) => {
  res.status(201).json(await createOrder(req.buyer.id, req.body));
});

ordersRouter.get('/', async (req, res) => {
  res.json(await listOrders(req.buyer.id));
});

ordersRouter.get('/:id', async (req, res) => {
  res.json(await getOrder(req.buyer.id, parseId(req.params.id)));
});

ordersRouter.post('/:id/pay', async (req, res) => {
  res.json(await payOrder(req.buyer.id, parseId(req.params.id)));
});

ordersRouter.post('/:id/cancel', async (req, res) => {
  res.json(await cancelOrder(req.buyer.id, parseId(req.params.id)));
});