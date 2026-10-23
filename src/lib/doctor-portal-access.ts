import type { Prisma } from "../../generated/prisma/client";

export type DoctorAccessCapability = "orders" | "reports";

/** Explicit clinical disclosure: referring-physician relationship alone is insufficient. */
export function doctorAccessWhere(args: {
  organizationId: string;
  referrerId: string;
  capability: DoctorAccessCapability;
  now: Date;
}): Prisma.LabOrderWhereInput {
  return {
    organizationId: args.organizationId,
    referrerId: args.referrerId,
    patient: {
      organizationId: args.organizationId,
      doctorPortalAccess: {
        some: {
          organizationId: args.organizationId,
          referrerId: args.referrerId,
          status: "ACTIVE",
          effectiveFrom: { lte: args.now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: args.now } }],
          ...(args.capability === "reports" ? { canViewReports: true } : {
            canViewOrders: true,
          }),
        },
      },
    },
  };
}

export function validDoctorAccessDates(start: Date, end: Date | null) {
  return Number.isFinite(start.getTime()) && (!end ||
    (Number.isFinite(end.getTime()) && end.getTime() >= start.getTime()));
}

export function validDoctorAccessReason(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 10 &&
    value.trim().length <= 1000 && !/[\u0000-\u001F\u007F]/.test(value);
}


/** A retained portal session does not survive deactivation or tenant reassignment of its physician. */
export function hasLiveDoctorPortalReferrer(account:{
  type:string;
  organizationId:string;
  referrerId:string|null;
  referrer:{id:string;organizationId:string;status:string;type:string}|null;
}):boolean {
  const referrer=account.referrer;
  return account.type==="DOCTOR" && !!account.referrerId && !!referrer &&
    referrer.id===account.referrerId &&
    referrer.organizationId===account.organizationId &&
    referrer.status==="ACTIVE" &&
    referrer.type==="PHYSICIAN";
}
