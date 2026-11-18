import { Router } from 'express';
import { createEvent, listEvents, getEventById } from '../services/events.js';
import { HttpError } from '../errors.js';

export const eventsRouter = Router();

eventsRouter.post('/', async (req, res) => {
  const event = await createEvent(req.body);
  res.status(201).json(event);
});

eventsRouter.get('/', async (req, res) => {
  res.json(await listEvents());
});

eventsRouter.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new HttpError(400, 'id harus bilangan bulat positif');
  }
  res.json(await getEventById(id));
});