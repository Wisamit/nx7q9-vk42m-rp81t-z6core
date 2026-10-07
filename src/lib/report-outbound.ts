export type ReportOutboundChannel = "EMAIL" | "SMS" | "WHATSAPP";
export type ReportOutboundRecipientType = "PATIENT" | "REFERRER" | "CLIENT";

export type PortalDeliveryAccount = {
  status: string;
  contactVerifiedAt: Date | null;
  email: string | null;
  phone: string | null;
  preferredLocale: string;
};

export type ReportMessageContext = {
  patientName: string;
  accessionNumber: string;
  reportVersion: number;
  reportStatus: string;
  portalUrl: string;
};

export function resolveVerifiedPortalDestination(
  account: PortalDeliveryAccount | null | undefined,
  channel: ReportOutboundChannel,
) {
  if (!account || account.status !== "ACTIVE") {
    return { ok: false as const, error: "active_portal_account_required" };
  }
  if (!account.contactVerifiedAt) {
    return { ok: false as const, error: "verified_portal_contact_required" };
  }

  const destination = channel === "EMAIL" ? account.email?.trim() : account.phone?.trim();
  if (!destination) {
    return {
      ok: false as const,
      error: channel === "EMAIL" ? "verified_email_required" : "verified_phone_required",
    };
  }

  return {
    ok: true as const,
    destination,
    locale: account.preferredLocale === "ar" ? "ar" as const : "en" as const,
  };
}

export function renderReportTemplate(
  value: string,
  context: ReportMessageContext,
) {
  const replacements: Record<string, string> = {
    "{{patientName}}": context.patientName,
    "{{accessionNumber}}": context.accessionNumber,
    "{{reportVersion}}": String(context.reportVersion),
    "{{reportStatus}}": context.reportStatus,
    "{{portalUrl}}": context.portalUrl,
  };

  let rendered = value;
  for (const [token, replacement] of Object.entries(replacements)) {
    rendered = rendered.replaceAll(token, replacement);
  }
  return rendered;
}

export function defaultReportReadyMessage(
  locale: "ar" | "en",
  context: ReportMessageContext,
) {
  if (locale === "ar") {
    return {
      title: "تقرير المختبر جاهز",
      body: `مرحباً ${context.patientName}، تقرير المختبر للطلب ${context.accessionNumber} (الإصدار ${context.reportVersion}) جاهز. افتح التقرير بأمان بعد تسجيل الدخول إلى بوابتك: ${context.portalUrl}`,
    };
  }
  return {
    title: "Laboratory report ready",
    body: `Hello ${context.patientName}, your laboratory report for accession ${context.accessionNumber} (version ${context.reportVersion}) is ready. Sign in to your secure portal to view it: ${context.portalUrl}`,
  };
}

export function maskedDestination(channel: ReportOutboundChannel, destination: string) {
  if (channel === "EMAIL") {
    const [local, domain] = destination.split("@");
    if (!domain) return "***";
    const visible = local.slice(0, Math.min(2, local.length));
    return `${visible}***@${domain}`;
  }
  const compact = destination.replace(/\s+/g, "");
  if (compact.length <= 4) return "****";
  return `${"*".repeat(Math.min(8, compact.length - 4))}${compact.slice(-4)}`;
}
