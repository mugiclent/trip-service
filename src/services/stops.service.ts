import { prisma } from '../models/index.js';
import type { Stop } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { candidateWhere } from '../utils/overrides.js';

/**
 * Stops follow the copy-on-write override pattern (see src/utils/overrides.ts) with
 * one twist: a fork keeps the platform default's **id** as the canonical identity
 * and only overlays display fields (name/lat/lng/city). Routes, prices and tickets
 * always reference the canonical id, so an org editing a stop never forces those
 * references to re-point. Net-new org stops (override_of = null) are referenced by
 * their own id. `orgId` is the acting org (null = platform admin on the defaults).
 */

type StopPatch = Partial<{ name: string; lat: number; lng: number; city: string }>;

const overlay = (def: Stop, fork: Stop): Stop => ({
  ...def,
  name: fork.name,
  lat: fork.lat,
  lng: fork.lng,
  city: fork.city,
}); // keep def.id (the canonical identity) so references stay valid

/**
 * Effective stop list for `orgId`: platform defaults overlaid with the org's forks
 * (canonical id preserved), tombstoned defaults removed, plus the org's net-new stops.
 */
export const listStops = async (orgId: string | null, q?: string): Promise<Stop[]> => {
  const rows = await prisma.stop.findMany({ where: candidateWhere(orgId), orderBy: { name: 'asc' } });

  const forkByCanonical = new Map<string, Stop>();
  const hiddenCanonical = new Set<string>();
  const netNew: Stop[] = [];
  for (const r of rows) {
    if (!orgId || r.org_id !== orgId) continue;
    if (r.override_of) {
      if (r.is_hidden) hiddenCanonical.add(r.override_of);
      else forkByCanonical.set(r.override_of, r);
    } else if (!r.is_hidden) {
      netNew.push(r);
    }
  }

  const effective: Stop[] = [];
  for (const r of rows) {
    if (r.org_id !== null) continue; // defaults only here; org rows handled above
    if (hiddenCanonical.has(r.id)) continue;
    const fork = forkByCanonical.get(r.id);
    effective.push(fork ? overlay(r, fork) : r);
  }
  effective.push(...netNew);

  const matches = q
    ? effective.filter((s) => s.name.toLowerCase().includes(q.toLowerCase()))
    : effective;
  return matches.sort((a, b) => a.name.localeCompare(b.name));
};

export const createStop = async (
  orgId: string | null,
  data: { name: string; lat: number; lng: number; city?: string },
): Promise<Stop> => {
  return prisma.stop.create({ data: { ...data, org_id: orgId } });
};

/**
 * Resolve a single effective stop for `orgId` by canonical id (or a net-new org id):
 * the org's fork overlays the default, a tombstone yields NOT_FOUND, otherwise the
 * default (or the org's own net-new stop).
 */
export const getStop = async (orgId: string | null, id: string): Promise<Stop> => {
  const stop = await prisma.stop.findUnique({ where: { id } });
  if (!stop) throw new AppError('STOP_NOT_FOUND', 404);

  // Net-new org stop: visible only to its owner.
  if (stop.org_id !== null) {
    if (stop.org_id === orgId && !stop.is_hidden) return stop;
    throw new AppError('STOP_NOT_FOUND', 404);
  }

  // Platform default — overlay the org's fork / honour a tombstone.
  if (orgId) {
    const fork = await prisma.stop.findFirst({ where: { org_id: orgId, override_of: id } });
    if (fork) {
      if (fork.is_hidden) throw new AppError('STOP_NOT_FOUND', 404);
      return overlay(stop, fork);
    }
  }
  return stop;
};

export const updateStop = async (orgId: string | null, id: string, data: StopPatch): Promise<Stop> => {
  const target = await prisma.stop.findUnique({ where: { id } });
  if (!target) throw new AppError('STOP_NOT_FOUND', 404);

  // Org editing a platform default → fork (preserving the canonical id for references).
  if (orgId && target.org_id === null) {
    const existing = await prisma.stop.findFirst({ where: { org_id: orgId, override_of: id } });
    const merged = {
      name: data.name ?? target.name,
      lat: data.lat ?? Number(target.lat),
      lng: data.lng ?? Number(target.lng),
      city: data.city ?? target.city ?? undefined,
    };
    if (existing) {
      const fork = await prisma.stop.update({ where: { id: existing.id }, data: { ...merged, is_hidden: false } });
      return overlay(target, fork);
    }
    const fork = await prisma.stop.create({ data: { ...merged, org_id: orgId, override_of: id } });
    return overlay(target, fork);
  }

  // Editing own row (net-new or platform default as admin) — mutate in place.
  if (target.org_id === orgId) {
    return prisma.stop.update({ where: { id }, data });
  }
  throw new AppError('STOP_NOT_FOUND', 404);
};

export const deleteStop = async (orgId: string | null, id: string): Promise<void> => {
  const target = await prisma.stop.findUnique({ where: { id } });
  if (!target) throw new AppError('STOP_NOT_FOUND', 404);

  // Org "deleting" a platform default → tombstone it for that org only.
  if (orgId && target.org_id === null) {
    const existing = await prisma.stop.findFirst({ where: { org_id: orgId, override_of: id } });
    if (existing) {
      await prisma.stop.update({ where: { id: existing.id }, data: { is_hidden: true } });
    } else {
      await prisma.stop.create({
        data: {
          org_id: orgId, override_of: id, is_hidden: true,
          name: target.name, lat: target.lat, lng: target.lng, city: target.city,
        },
      });
    }
    return;
  }

  // Hard delete of own net-new stop / a default as platform admin — block if referenced.
  if (target.org_id === orgId) {
    const inUse = await prisma.routeStop.count({ where: { stop_id: id } });
    if (inUse > 0) throw new AppError('STOP_IN_USE', 409);
    await prisma.stop.delete({ where: { id } });
    return;
  }
  throw new AppError('STOP_NOT_FOUND', 404);
};
