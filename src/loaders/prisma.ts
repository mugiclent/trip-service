import { prisma } from '../models/index.js';

export const initPrisma = async (): Promise<void> => {
  await prisma.$connect();
  console.warn('[prisma] Connected to database');
};

// ── Health ──────────────────────────────────────────────────────────────────
// Real `SELECT 1`, cached 5s so the gateway/Docker's frequent probes don't
// hammer the DB (matches the platform health contract).

const HEALTH_CACHE_TTL_MS = 5_000;
let dbHealthCache: { ok: boolean; error?: string; ts: number } | null = null;

export const checkDbHealth = async (): Promise<{ ok: boolean; error?: string }> => {
  const now = Date.now();
  if (dbHealthCache && now - dbHealthCache.ts < HEALTH_CACHE_TTL_MS) {
    const { ok, error } = dbHealthCache;
    return { ok, error };
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbHealthCache = { ok: true, ts: now };
    return { ok: true };
  } catch (err) {
    const error = (err as Error).message;
    dbHealthCache = { ok: false, error, ts: now };
    return { ok: false, error };
  }
};
