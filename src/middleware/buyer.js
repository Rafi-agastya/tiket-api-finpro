import { findUser } from '../services/users.js';
import { HttpError } from '../errors.js';

export async function requireBuyer(req, res, next) {
  const raw = req.get('X-Buyer-Id');
  const id = Number(raw);
  if (!raw || !Number.isSafeInteger(id) || id <= 0) {
    throw new HttpError(401, 'Header X-Buyer-Id wajib diisi dengan id pembeli');
  }
  const user = await findUser(id);
  if (!user) {
    throw new HttpError(401, 'Pembeli tidak dikenal');
  }
  req.buyer = user;
  next();
}