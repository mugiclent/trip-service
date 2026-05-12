import type { AuthenticatedUser } from '../utils/ability.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
