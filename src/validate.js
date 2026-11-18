import { HttpError } from './errors.js';

export function parseId(raw) {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new HttpError(400, 'id harus bilangan bulat positif');
  }
  return id;
}