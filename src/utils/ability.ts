import { createMongoAbility } from '@casl/ability';
import type { MongoAbility, RawRuleOf } from '@casl/ability';

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
  if (rules.some((r) => r.conditions && 'id' in (r.conditions as object))) return 'own';
  return null;
};
