import { createMongoAbility } from '@casl/ability';
import type { MongoAbility, RawRuleOf } from '@casl/ability';
import { accessibleBy } from '@casl/prisma';
import { AppError } from './AppError.js';

export type Actions =
  | 'manage' | 'read' | 'create' | 'update' | 'delete'
  | 'invite' | 'suspend' | 'assign_role' | 'approve' | 'upload' | 'export'
  | 'receive' | 'override' | 'cancel' | 'refund' | 'topup' | 'pay'
  | 'read_manifest' | 'validate';

export type Subjects =
  | 'all'
  | 'Trip' | 'Route' | 'Location' | 'Bus' | 'Ticket' | 'Price'
  | 'User' | 'Org' | 'Role' | 'Invitation' | 'OrgDocument'
  | 'AuditLog' | 'Notification' | 'Permission'
  | 'Wallet' | 'Payment' | 'Refund' | 'Payout' | 'Finance'
  | 'Billing' | 'Commission' | 'TaxReceipt' | 'Vsdc' | 'Report';

export type AppAbility = MongoAbility<[Actions, Subjects]>;
export type AppRule = RawRuleOf<AppAbility>;

export type PermissionScope = 'own' | 'org' | 'platform';

export interface AuthenticatedUser {
  id: string;
  org_id: string | null;
  user_type: 'passenger' | 'staff';
  role_slugs: string[];
  rules: AppRule[];
  locale: string;
}

export const buildAbilityFromRules = (rules: AppRule[]): AppAbility =>
  createMongoAbility<AppAbility>(rules);

export const getScopeFor = (
  ability: AppAbility,
  action: Actions,
  subject: Subjects,
): PermissionScope | null => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rules = ability.rulesFor(action, subject as any);
  if (rules.some((r) => !r.conditions)) return 'platform';
  if (rules.some((r) => r.conditions && 'org_id' in (r.conditions as object))) return 'org';
  // The Org subject references its own org by `id` (no `org_id` on an Org row), so
  // an org-scoped grant on Org bakes `{ id: orgId }` — that is ORG scope, not own.
  if (subject === 'Org' && rules.some((r) => r.conditions && 'id' in (r.conditions as object))) return 'org';
  if (rules.some((r) => r.conditions && (('id' in (r.conditions as object)) || ('user_id' in (r.conditions as object))))) return 'own';
  return null;
};

/**
 * Prisma `where` filter encoding the caller's own/org/platform boundary for a
 * subject, derived from their baked rule conditions — use on list endpoints so
 * scoping is never hand-written:
 *   prisma.trip.findMany({ where: { AND: [ accessibleWhere(ability,'read','Trip'), ...filters ] } })
 *
 * platform → {} (all); org → { OR:[{org_id}] }; own → { OR:[{user_id}] }.
 * If NO rule permits the action, @casl throws — surfaced as a real 403 rather
 * than masked as an empty result (route gates normally catch this first).
 */
export const accessibleWhere = (
  ability: AppAbility,
  action: Actions,
  subjectName: Exclude<Subjects, 'all'>,
): Record<string, unknown> => {
  const records = accessibleBy(ability as Parameters<typeof accessibleBy>[0], action) as Record<string, Record<string, unknown>>;
  try {
    return records[subjectName];
  } catch {
    // No rule permits this action on this subject — forbidden, not "empty".
    throw new AppError('FORBIDDEN', 403);
  }
};
