export type ReportOutboundChannel = "EMAIL" | "SMS" | "WHATSAPP";
export type ReportOutboundRecipientType = "PATIENT" | "REFERRER" | "CLIENT";

export type PortalDeliveryAccount = {
  status: string;
  contactVerifiedAt: Date | null;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
  email: string | null;
  phone: string | null;
  preferredLocale: string;
  contactVerifications?: Array<{
    channel: "EMAIL" | "PHONE";
    destinationSnapshot: string;
    revokedAt: Date | null;
    verifiedAt?: Date;
  }>;
};

export type ReportMessageContext = {
  recipientName: string;
  patientName: string;
  accessionNumber: string;
  reportVersion: number;
  reportStatus: string;
  portalUrl: string;
};

export function normalizePortalContactDestination(
  channel: "EMAIL" | "PHONE",
  destination: string,
) {
  const trimmed = destination.trim();
  return channel === "EMAIL" ? trimmed.toLowerCase() : trimmed.replace(/\s+/g, "");
}

export function resolveVerifiedPortalDestination(
  account: PortalDeliveryAccount | null | undefined,
  channel: ReportOutboundChannel,
) {
  if (!account || account.status !== "ACTIVE") {
    return { ok: false as const, error: "active_portal_account_required" };
  }
  const destination = channel === "EMAIL" ? account.email?.trim() : account.phone?.trim();
  if (!destination) {
    return {
      ok: false as const,
      error: channel === "EMAIL" ? "verified_email_required" : "verified_phone_required",
    };
  }

  const verificationChannel = channel === "EMAIL" ? "EMAIL" : "PHONE";
  const normalizedDestination = normalizePortalContactDestination(verificationChannel, destination);
  const verified = account.contactVerifications?.some(item =>
    item.channel === verificationChannel
    && item.revokedAt === null
    && normalizePortalContactDestination(item.channel, item.destinationSnapshot) === normalizedDestination
  ) || false;

  if (!verified) {
    return {
      ok: false as const,
      error: verificationChannel === "EMAIL" ? "verified_email_required" : "verified_phone_required",
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
    "{{recipientName}}": context.recipientName,
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
  recipientType: ReportOutboundRecipientType,
  context: ReportMessageContext,
) {
  if (locale === "ar") {
    return {
      title: "تقرير المختبر جاهز",
      body: recipientType === "PATIENT"
        ? `مرحباً ${context.recipientName}، تقرير المختبر للطلب ${context.accessionNumber} (الإصدار ${context.reportVersion}) جاهز. افتح التقرير بأمان بعد تسجيل الدخول إلى بوابتك: ${context.portalUrl}`
        : `مرحباً ${context.recipientName}، تقرير المختبر للمريض ${context.patientName} للطلب ${context.accessionNumber} (الإصدار ${context.reportVersion}) جاهز. افتح التقرير بأمان بعد تسجيل الدخول إلى بوابتك: ${context.portalUrl}`,
    };
  }
  return {
    title: "Laboratory report ready",
    body: recipientType === "PATIENT"
      ? `Hello ${context.recipientName}, your laboratory report for accession ${context.accessionNumber} (version ${context.reportVersion}) is ready. Sign in to your secure portal to view it: ${context.portalUrl}`
      : `Hello ${context.recipientName}, the laboratory report for patient ${context.patientName}, accession ${context.accessionNumber} (version ${context.reportVersion}), is ready. Sign in to your secure portal to view it: ${context.portalUrl}`,
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
