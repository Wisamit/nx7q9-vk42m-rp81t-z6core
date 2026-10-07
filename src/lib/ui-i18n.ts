export type UiLocale = "ar" | "en";

export function getUiLocale(value: string | null | undefined): UiLocale {
  return value === "ar" ? "ar" : "en";
}

export function tr<T>(locale: UiLocale, en: T, ar: T): T {
  return locale === "ar" ? ar : en;
}

const STATUS_AR: Record<string, string> = {
  ACTIVE: "نشط",
  INACTIVE: "غير نشط",
  SUSPENDED: "معلّق",
  DISABLED: "معطّل",
  DRAFT: "مسودة",
  APPROVED: "معتمد",
  PLANNED: "مخطط",
  COLLECTION_FAILED: "فشل السحب",
  COLLECTED: "تم الجمع",
  RECEIVED: "تم الاستلام",
  IN_TRANSIT: "قيد النقل",
  IN_PROCESS: "قيد المعالجة",
  REJECTED: "مرفوض",
  DISPOSED: "تم التخلص",
  ORDERED: "مطلوب",
  IN_PROGRESS: "قيد العمل",
  RESULTED: "تم إدخال النتيجة",
  VERIFIED: "تم التحقق",
  RELEASED: "تم الإصدار",
  AMENDED: "معدّل",
  CANCELLED: "ملغى",
  COMPLETED: "مكتمل",
  OPEN: "مفتوح",
  CLOSED: "مغلق",
  WAITING: "بانتظار",
  DISPATCHED: "تم الإرسال",
  RESULT_RECEIVED: "تم استلام النتيجة",
  FINAL: "نهائي",
  PENDING: "قيد الانتظار",
  PENDING_APPROVAL: "بانتظار الاعتماد",
  ENTERED: "تم الإدخال",
  PARTIAL: "جزئي",
  RETRACTED: "مسحوب",
  ISSUED: "صادرة",
  PARTIALLY_PAID: "مدفوعة جزئيًا",
  PAID: "مدفوعة",
  VOID: "ملغاة ماليًا",
  CREDITED: "تم إصدار رصيد دائن",
  POSTED: "مرحّلة",
  VOIDED: "ملغاة",
  REFUNDED: "مستردة",
  INVITED: "مدعو",
  REQUESTED: "مطلوب",
  CONFIRMED: "مؤكد",
  CHECKED_IN: "تم تسجيل الحضور",
  NO_SHOW: "لم يحضر",
  SCHEDULED: "مجدول",
  EN_ROUTE: "في الطريق",
  ARRIVED: "وصل",
  DELIVERED: "تم التسليم",
  CALLED: "تم النداء",
  SERVING: "قيد الخدمة",
  NO_GROWTH: "لا يوجد نمو",
  GROWTH: "نمو",
  MIXED_GROWTH: "نمو مختلط",
  CONTAMINATED: "ملوث",
  PRELIMINARY: "أولي",
  WARN: "تحذير",
  FAIL: "فشل",
  PASS: "ناجح",
  BLOCK: "حظر",
  RESOLVED: "تم الحل",
  ACKNOWLEDGED: "تم الإقرار",
  DEAD_LETTER: "متعذر المعالجة",
  QUEUED: "في قائمة الانتظار",
  SENT: "تم الإرسال",
  FAILED: "فشل",
};

const PRIORITY_AR: Record<string, string> = {
  ROUTINE: "عادي",
  URGENT: "عاجل",
  STAT: "فوري",
};

const SEX_AR: Record<string, string> = {
  MALE: "ذكر",
  FEMALE: "أنثى",
  OTHER: "آخر",
  UNKNOWN: "غير محدد",
};

export function statusLabel(locale: UiLocale, value: string | null | undefined) {
  if (!value) return "—";
  return locale === "ar" ? STATUS_AR[value] || value : value;
}

export function priorityLabel(locale: UiLocale, value: string | null | undefined) {
  if (!value) return "—";
  return locale === "ar" ? PRIORITY_AR[value] || value : value;
}

export function sexLabel(locale: UiLocale, value: string | null | undefined) {
  if (!value) return "—";
  return locale === "ar" ? SEX_AR[value] || value : value;
}
