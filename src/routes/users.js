import { Router } from 'express';
import { createUser } from '../services/users.js';

export const usersRouter = Router();

usersRouter.post('/', async (req, res) => {
  res.status(201).json(await createUser(req.body));
});