/**
 * Focused check for the middleware edit: `authenticate` must lift the gateway's
 * `x-user-phone` header onto `req.user.phone` (and default to null when absent).
 * Pure — no infra. Run:  npx tsx tests/unit/authenticate-phone.test.ts
 */
import type { Request, Response } from 'express';
import { authenticate } from '../../src/middleware/authenticate.js';
import type { AuthenticatedUser } from '../../src/utils/ability.js';

let passed = 0, failed = 0;
const ok = (n: string, c: boolean, d = ''): void => {
  if (c) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${n}`); }
  else { failed++; console.log(`  \x1b[31m✗ ${n}\x1b[0m ${d}`); }
};

const run = (headers: Record<string, string>): { user?: AuthenticatedUser; err?: unknown } => {
  const req = { headers } as unknown as Request;
  let err: unknown;
  authenticate(req, {} as Response, (e?: unknown) => { err = e; });
  return { user: (req as Request & { user?: AuthenticatedUser }).user, err };
};

console.log('── authenticate(): x-user-phone extraction ──');

const base = { 'x-user-id': '521fa2bc-812b-4a78-a34e-17d62aaafeaa', 'x-user-type': 'passenger', 'x-user-rules': '[]' };

const withPhone = run({ ...base, 'x-user-phone': '250789428456' });
ok('forwards x-user-phone onto req.user.phone', withPhone.user?.phone === '250789428456', `(got ${withPhone.user?.phone})`);
ok('no error on valid headers', !withPhone.err);

const noPhone = run({ ...base });
ok('phone defaults to null when header absent', noPhone.user?.phone === null, `(got ${String(noPhone.user?.phone)})`);

console.log(`\n\x1b[1mResult: ${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed === 0 ? 0 : 1);
