import { NextResponse } from "next/server";
import { getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  getOrganizationSystemSettings,
  normalizePalette,
  validateImageDataUrl,
} from "@/lib/system-settings";

const DATE_FORMATS = new Set(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD MMM YYYY"]);
const TIME_FORMATS = new Set(["12", "24"]);
const THEMES = new Set(["LIGHT", "DARK", "SYSTEM"]);
const DENSITIES = new Set(["COMFORTABLE", "COMPACT"]);
const TIMEZONES = new Set(["Africa/Cairo", "Asia/Dubai", "Asia/Riyadh", "Asia/Beirut", "Asia/Damascus", "Europe/Istanbul", "UTC"]);

function text(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!permissionSet(session).has("organization.view") && !permissionSet(session).has("settings.manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json({ settings: await getOrganizationSystemSettings(session.user.organizationId) });
}

export async function PUT(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!permissionSet(session).has("settings.manage")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const organizationNameEn = text(body.organizationNameEn);
  const organizationNameAr = text(body.organizationNameAr);
  const systemNameEn = text(body.systemNameEn);
  const systemNameAr = text(body.systemNameAr);
  const timezone = typeof body.timezone === "string" && TIMEZONES.has(body.timezone) ? body.timezone : null;
  const defaultTheme = typeof body.defaultTheme === "string" && THEMES.has(body.defaultTheme) ? body.defaultTheme : null;
  const dateFormat = typeof body.dateFormat === "string" && DATE_FORMATS.has(body.dateFormat) ? body.dateFormat : null;
  const timeFormat = typeof body.timeFormat === "string" && TIME_FORMATS.has(body.timeFormat) ? body.timeFormat : null;
  const density = typeof body.density === "string" && DENSITIES.has(body.density) ? body.density : null;
  const defaultLocale = body.defaultLocale === "ar" ? "ar" : body.defaultLocale === "en" ? "en" : null;
  const weekStartsOn = body.weekStartsOn === 0 || body.weekStartsOn === 1 || body.weekStartsOn === 6 ? body.weekStartsOn : null;
  const logoDataUrl = validateImageDataUrl(body.logoDataUrl);
  const faviconDataUrl = validateImageDataUrl(body.faviconDataUrl);

  if (!organizationNameEn || !systemNameEn || !timezone || !defaultTheme || !dateFormat || !timeFormat || !density || !defaultLocale || weekStartsOn === null) {
    return NextResponse.json({ error: "invalid_settings" }, { status: 400 });
  }
  if (logoDataUrl === undefined || faviconDataUrl === undefined) return NextResponse.json({ error: "invalid_image" }, { status: 400 });

  const lightTheme = normalizePalette(body.lightTheme, DEFAULT_LIGHT_THEME);
  const darkTheme = normalizePalette(body.darkTheme, DEFAULT_DARK_THEME);
  const before = await getOrganizationSystemSettings(session.user.organizationId);
  const ctx = await requestContext();

  await prisma.$transaction(async tx => {
    await tx.organization.update({
      where: { id: session.user.organizationId },
      data: { nameEn: organizationNameEn, nameAr: organizationNameAr || null, defaultTimezone: timezone },
    });
    await tx.organizationSetting.upsert({
      where: { organizationId: session.user.organizationId },
      create: {
        organizationId: session.user.organizationId,
        systemNameEn,
        systemNameAr: systemNameAr || null,
        logoDataUrl,
        faviconDataUrl,
        defaultTheme,
        dateFormat,
        timeFormat,
        showSeconds: body.showSeconds === true,
        defaultLocale,
        weekStartsOn,
        density,
        lightTheme,
        darkTheme,
      },
      update: {
        systemNameEn,
        systemNameAr: systemNameAr || null,
        logoDataUrl,
        faviconDataUrl,
        defaultTheme,
        dateFormat,
        timeFormat,
        showSeconds: body.showSeconds === true,
        defaultLocale,
        weekStartsOn,
        density,
        lightTheme,
        darkTheme,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "SYSTEM_SETTINGS_UPDATED",
        entityType: "OrganizationSetting",
        entityId: session.user.organizationId,
        oldValues: {
          organizationNameEn: before.organizationNameEn,
          organizationNameAr: before.organizationNameAr,
          systemNameEn: before.systemNameEn,
          systemNameAr: before.systemNameAr,
          timezone: before.timezone,
          defaultTheme: before.defaultTheme,
          dateFormat: before.dateFormat,
          timeFormat: before.timeFormat,
          showSeconds: before.showSeconds,
          defaultLocale: before.defaultLocale,
          weekStartsOn: before.weekStartsOn,
          density: before.density,
          lightTheme: before.lightTheme,
          darkTheme: before.darkTheme,
          logoConfigured: Boolean(before.logoDataUrl),
          faviconConfigured: Boolean(before.faviconDataUrl),
        },
        newValues: {
          organizationNameEn,
          organizationNameAr: organizationNameAr || null,
          systemNameEn,
          systemNameAr: systemNameAr || null,
          timezone,
          defaultTheme,
          dateFormat,
          timeFormat,
          showSeconds: body.showSeconds === true,
          defaultLocale,
          weekStartsOn,
          density,
          lightTheme,
          darkTheme,
          logoConfigured: Boolean(logoDataUrl),
          faviconConfigured: Boolean(faviconDataUrl),
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  });

  return NextResponse.json({ status: "ok" });
}
