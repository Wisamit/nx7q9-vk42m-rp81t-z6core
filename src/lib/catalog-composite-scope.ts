/**
 * Clinical permission scopes are deliberately different from empty global
 * grants: a revoked scoped user must not silently become organization-wide.
 */
export const compositeUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export type DepartmentGrant = { departmentId: string };
export function intersectCompositeDepartments<T extends DepartmentGrant>(
  initiallyGranted: readonly string[], liveGrants: readonly T[],
): T[] | null {
  const initial = new Set(initiallyGranted);
  if (initial.size === 0) return liveGrants.length === 0 ? [] : null;
  const intersected = liveGrants.filter(item => initial.has(item.departmentId));
  return intersected.length > 0 ? intersected : null;
}
