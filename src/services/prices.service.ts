import { prisma } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { candidateWhere, resolveEffective } from '../utils/overrides.js';

/**
 * Prices follow the copy-on-write override pattern (see src/utils/overrides.ts):
 * the platform ships default fares (org_id = null); an org never mutates a default
 * — editing one forks an org-scoped copy that shadows it, and "deleting" a default
 * tombstones it for that org only. `orgId` is the acting org (null = platform admin
 * operating on the shared defaults).
 */

const findDefault = (boarding_stop_id: string, alighting_stop_id: string) =>
  prisma.price.findFirst({ where: { boarding_stop_id, alighting_stop_id, org_id: null } });

const findOrgRow = (orgId: string, boarding_stop_id: string, alighting_stop_id: string) =>
  prisma.price.findFirst({ where: { boarding_stop_id, alighting_stop_id, org_id: orgId } });

/**
 * Upsert an org's fork of a stop-pair fare (also un-hides a prior tombstone). Links
 * back to the platform default via override_of when one exists.
 */
const setOrgPrice = async (
  orgId: string,
  boarding_stop_id: string,
  alighting_stop_id: string,
  amount: number,
  currency?: string,
) => {
  const def = await findDefault(boarding_stop_id, alighting_stop_id);
  const existing = await findOrgRow(orgId, boarding_stop_id, alighting_stop_id);
  if (existing) {
    return prisma.price.update({
      where: { id: existing.id },
      data: { amount, is_hidden: false, override_of: def?.id ?? null, ...(currency ? { currency } : {}) },
    });
  }
  return prisma.price.create({
    data: { org_id: orgId, boarding_stop_id, alighting_stop_id, amount, override_of: def?.id ?? null, ...(currency ? { currency } : {}) },
  });
};

/**
 * Effective fare for a stop-pair as seen by `orgId`: the org's fork wins, a
 * tombstone yields null, otherwise the platform default (or null if none).
 */
export const getEffectivePrice = async (
  orgId: string | null,
  boarding_stop_id: string,
  alighting_stop_id: string,
) => {
  if (orgId) {
    const own = await findOrgRow(orgId, boarding_stop_id, alighting_stop_id);
    if (own) return own.is_hidden ? null : own;
  }
  return findDefault(boarding_stop_id, alighting_stop_id);
};

/** Effective fare list for `orgId` (defaults overlaid with the org's forks). */
export const listEffectivePrices = async (orgId: string | null) => {
  const rows = await prisma.price.findMany({ where: candidateWhere(orgId) });
  return resolveEffective(rows, orgId);
};

/**
 * Effective fares for `orgId` with stop names, for the price-matrix grid. Optionally
 * filtered to a boarding and/or alighting stop (the grid's origin/destination filters).
 */
export const listEffectivePricesDetailed = async (
  orgId: string | null,
  filters: { boarding_stop_id?: string; alighting_stop_id?: string } = {},
) => {
  const rows = await prisma.price.findMany({
    where: candidateWhere(orgId),
    include: {
      boarding_stop: { select: { id: true, name: true } },
      alighting_stop: { select: { id: true, name: true } },
    },
  });
  let effective = resolveEffective(rows, orgId);
  if (filters.boarding_stop_id) effective = effective.filter((p) => p.boarding_stop_id === filters.boarding_stop_id);
  if (filters.alighting_stop_id) effective = effective.filter((p) => p.alighting_stop_id === filters.alighting_stop_id);
  return effective;
};

export const createPrice = async (
  orgId: string | null,
  data: { boarding_stop_id: string; alighting_stop_id: string; amount: number; currency?: string },
) => {
  if (orgId) return setOrgPrice(orgId, data.boarding_stop_id, data.alighting_stop_id, data.amount, data.currency);
  // Platform admin — create or replace a shared default.
  const def = await findDefault(data.boarding_stop_id, data.alighting_stop_id);
  if (def) return prisma.price.update({ where: { id: def.id }, data: { amount: data.amount, ...(data.currency ? { currency: data.currency } : {}) } });
  return prisma.price.create({ data: { ...data, org_id: null } });
};

export const getPrice = async (
  orgId: string | null,
  boarding_stop_id: string,
  alighting_stop_id: string,
) => {
  const price = await getEffectivePrice(orgId, boarding_stop_id, alighting_stop_id);
  if (!price) throw new AppError('PRICE_NOT_FOUND', 404);
  return price;
};

export const updatePrice = async (orgId: string | null, id: string, data: { amount: number }) => {
  const target = await prisma.price.findUnique({ where: { id } });
  if (!target) throw new AppError('PRICE_NOT_FOUND', 404);

  // Org editing a platform default → fork instead of mutating the shared row.
  if (orgId && target.org_id === null) {
    return setOrgPrice(orgId, target.boarding_stop_id, target.alighting_stop_id, data.amount);
  }
  // Editing own row, or platform admin editing a default — mutate in place.
  if (target.org_id === orgId) {
    return prisma.price.update({ where: { id }, data: { amount: data.amount, is_hidden: false } });
  }
  // Another org's row — not visible to this caller.
  throw new AppError('PRICE_NOT_FOUND', 404);
};

export const deletePrice = async (orgId: string | null, id: string): Promise<void> => {
  const target = await prisma.price.findUnique({ where: { id } });
  if (!target) throw new AppError('PRICE_NOT_FOUND', 404);

  // Org "deleting" a platform default → tombstone it for that org only.
  if (orgId && target.org_id === null) {
    const existing = await findOrgRow(orgId, target.boarding_stop_id, target.alighting_stop_id);
    if (existing) {
      await prisma.price.update({ where: { id: existing.id }, data: { is_hidden: true, override_of: target.id } });
    } else {
      await prisma.price.create({
        data: {
          org_id: orgId, boarding_stop_id: target.boarding_stop_id,
          alighting_stop_id: target.alighting_stop_id, amount: target.amount,
          override_of: target.id, is_hidden: true,
        },
      });
    }
    return;
  }
  // Deleting own fork (reverts to the default) or a default as platform admin.
  if (target.org_id === orgId) {
    await prisma.price.delete({ where: { id } });
    return;
  }
  throw new AppError('PRICE_NOT_FOUND', 404);
};

export const bulkUpsertPrices = async (
  orgId: string | null,
  prices: Array<{ boarding_stop_id: string; alighting_stop_id: string; amount: number }>,
) => {
  const results = [];
  for (const p of prices) {
    results.push(await createPrice(orgId, p));
  }
  return results;
};
