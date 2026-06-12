/**
 * Copy-on-write override semantics shared by reference resources (prices, stops,
 * routes — and mirrored by user-service roles).
 *
 * The platform ships **defaults** (`org_id = null`). An org never mutates a
 * default: the first time it edits one we fork an org-scoped copy that *shadows*
 * the default for that org only. Other orgs keep seeing the default.
 *
 *   default      → org_id = null,  override_of = null
 *   org fork     → org_id = X,     override_of = <default id>   (edited copy)
 *   org net-new  → org_id = X,     override_of = null           (brand-new)
 *   tombstone    → org_id = X,     override_of = <default id>,  is_hidden = true
 *                  (org suppressed a default without replacing it)
 *
 * The "effective" set an org sees is:
 *   (org's own non-hidden rows)  ∪  (defaults the org has neither forked nor hidden)
 */

export interface Overridable {
  id: string;
  org_id: string | null;
  override_of: string | null;
  is_hidden: boolean;
}

/**
 * Prisma `where` fragment selecting every row relevant to an org: the platform
 * defaults plus the org's own rows. Feed the result through {@link resolveEffective}
 * to collapse defaults that the org has shadowed.
 */
export const candidateWhere = (orgId: string | null) =>
  orgId ? { OR: [{ org_id: null }, { org_id: orgId }] } : { org_id: null };

/**
 * Collapse a candidate set (defaults + one org's rows) into the effective view:
 * the org's forks/net-new rows win over the defaults they shadow, tombstoned
 * defaults disappear, and untouched defaults pass through.
 */
export const resolveEffective = <T extends Overridable>(rows: T[], orgId: string | null): T[] => {
  if (!orgId) return rows.filter((r) => r.org_id === null && !r.is_hidden);

  const shadowed = new Set<string>();
  for (const r of rows) {
    if (r.org_id === orgId && r.override_of) shadowed.add(r.override_of);
  }

  return rows.filter((r) => {
    if (r.org_id === orgId) return !r.is_hidden;          // org's own forks / net-new
    if (r.org_id === null) return !shadowed.has(r.id);     // defaults not forked/hidden by org
    return false;                                          // another org's rows — never visible
  });
};
