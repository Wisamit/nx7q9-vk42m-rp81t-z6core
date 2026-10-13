import { permissionSet, type getCurrentSession } from "@/lib/auth";

export type StaffSession = NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>;
export const BRANCH_HOURS_KEY = "working_hours_v1";
export const WEEK_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DayKey = typeof WEEK_DAYS[number];
export type TimeWindow = { open: string; close: string };
export type WeeklyHours = { version: 1; days: Record<DayKey, TimeWindow[]> };

export function organizationBranchAdmin(session: StaffSession): boolean {
  return permissionSet(session).has("branches.manage")
    && session.user.roles.some(r => r.role.status === "ACTIVE" && r.role.code === "SYSTEM_ADMIN" && r.role.isSystem)
    && session.user.organization.status === "ACTIVE"
    && !!session.activeBranch
    && session.activeBranch.organizationId === session.user.organizationId
    && session.activeBranch.status === "ACTIVE"
    && session.user.branchScopes.some(s => s.branchId === session.activeBranchId && s.branch.status === "ACTIVE");
}

export function authorizedBranchIds(session: StaffSession) {
  return session.user.branchScopes
    .filter(s => s.branch.organizationId === session.user.organizationId && s.branch.status === "ACTIVE")
    .map(s => s.branchId);
}

export function canManageBranch(session: StaffSession, branchId: string): boolean {
  return permissionSet(session).has("branches.manage")
    && session.user.organization.status === "ACTIVE"
    && (organizationBranchAdmin(session) || authorizedBranchIds(session).includes(branchId));
}

export function inputText(value: unknown, max: number, required = false): string | null {
  if (value === undefined || value === null) return required ? null : "";
  if (typeof value !== "string") return null;
  const result = value.trim();
  if (result.length > max || (required && !result) || /[\u0000-\u001F\u007F]/.test(result)) return null;
  return result;
}

export function validCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.trim().toUpperCase();
  return /^[A-Z0-9._-]{2,50}$/.test(code) ? code : null;
}

export function validTimezone(input: unknown): input is string {
  if (typeof input !== "string" || input.length > 64) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: input }); return true; } catch { return false; }
}

const clockMinutes = (s: string) => {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(s)) return null;
  return s === "24:00" ? 1440 : Number(s.slice(0,2)) * 60 + Number(s.slice(3));
};

export function validateWeeklyHours(raw: unknown): WeeklyHours | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1 || !obj.days || typeof obj.days !== "object" || Array.isArray(obj.days)) return null;
  const days = obj.days as Record<string, unknown>;
  if (Object.keys(days).length !== 7 || Object.keys(days).some(k => !WEEK_DAYS.includes(k as DayKey))) return null;
  const result = {} as WeeklyHours["days"];
  for (const day of WEEK_DAYS) {
    const windows = days[day];
    if (!Array.isArray(windows) || windows.length > 4) return null;
    const validated: TimeWindow[] = [];
    for (const item of windows) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const pair = item as Record<string, unknown>;
      if (Object.keys(pair).length !== 2 || typeof pair.open !== "string" || typeof pair.close !== "string") return null;
      const start = clockMinutes(pair.open), end = clockMinutes(pair.close);
      if (start === null || end === null || start >= end || start === 1440) return null;
      if (validated.length && clockMinutes(validated[validated.length-1].close)! > start) return null;
      validated.push({open: pair.open, close: pair.close});
    }
    result[day] = validated;
  }
  return { version: 1, days: result };
}
