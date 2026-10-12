/**
 * Staff password changes never expose or log secrets.
 * bcrypt hashes at most 72 UTF-8 bytes, so reject truncated inputs.
 */
export function validateStaffPassword(value: unknown, confirmation: unknown): string | null {
  if (typeof value !== "string" || typeof confirmation !== "string")
    return "password_fields_required";
  if (value !== confirmation) return "password_confirmation_mismatch";
  if (value.length < 12 || Buffer.byteLength(value, "utf8") > 72 ||
      /[\u0000-\u001F\u007F]/.test(value))
    return "password_policy_failed";
  return null;
}

export function passwordResetReason(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length < 10 ||
      value.trim().length > 1000 || /[\u0000-\u001F\u007F]/.test(value))
    return null;
  return value.trim();
}

type ResetRole = { role: { code: string; status: string } };
export function isActiveSystemAdmin(roles: ResetRole[]): boolean {
  return roles.some(assignment =>
    assignment.role.code === "SYSTEM_ADMIN" && assignment.role.status === "ACTIVE");
}

export function staffCredentialTargetAllowed(args: {
  actorId: string;
  targetId: string;
  actorOrganizationId: string;
  targetOrganizationId: string;
  actorIsSystemAdmin: boolean;
  actorHasManagePermission: boolean;
  targetStatus: string;
}): boolean {
  return args.actorId !== args.targetId &&
    args.actorOrganizationId === args.targetOrganizationId &&
    args.actorIsSystemAdmin && args.actorHasManagePermission &&
    args.targetStatus === "ACTIVE";
}
