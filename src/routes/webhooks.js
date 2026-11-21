import { Router } from 'express';
import { handlePaymentWebhook } from '../services/webhooks.js';

export const webhooksRouter = Router();

webhooksRouter.post('/payment', async (req, res) => {
  res.status(200).json(await handlePaymentWebhook(req.body));
});