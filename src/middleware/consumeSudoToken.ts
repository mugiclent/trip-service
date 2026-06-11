/**
 * consumeSudoToken — shared sudo guard (copied from user-service).
 *
 * Verifies a short-lived, action-scoped, single-use step-up token minted by
 * user-service's POST /users/me/validate-password. Used here to gate wallet
 * ticket purchases by passengers.
 */
import type { Redis } from 'ioredis';
import { errors as JoseErrors } from 'jose';
import { AppError } from '../utils/AppError.js';
import { verifySudoToken } from '../utils/sudoToken.js';

export const consumeSudoToken = async (
  token: string | undefined,
  expectedUserId: string,
  expectedAction: string,
  redis: Redis,
): Promise<void> => {
  if (!token) {
    throw new AppError('STEP_UP_REQUIRED', 403);
  }

  let payload;
  try {
    payload = await verifySudoToken(token);
  } catch (err) {
    if (err instanceof JoseErrors.JWTExpired) {
      throw new AppError('STEP_UP_EXPIRED', 403);
    }
    throw new AppError('STEP_UP_INVALID', 403);
  }

  if (payload.type !== 'sudo') throw new AppError('STEP_UP_INVALID', 403);
  if (payload.action !== expectedAction) throw new AppError('STEP_UP_INVALID', 403);
  if (payload.sub !== expectedUserId) throw new AppError('STEP_UP_MISMATCH', 403);

  // Single-use: claim the jti for the rest of its lifetime. SET NX returns null
  // if another request already consumed it.
  const remainingTtl = payload.exp - Math.floor(Date.now() / 1000);
  const claimed = await redis.set(
    `sudo:used:${payload.jti}`,
    '1',
    'EX',
    Math.max(remainingTtl, 1),
    'NX',
  );

  if (claimed === null) {
    throw new AppError('STEP_UP_ALREADY_USED', 403);
  }
};
