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
  REQUESTED: "مطلوب",
  CONFIRMED: "مؤكد",
  CHECKED_IN: "تم تسجيل الحضور",
  NO_SHOW: "لم يحضر",
  SCHEDULED: "مجدول",
  ASSIGNED: "تم التعيين",
  EN_ROUTE: "في الطريق",
  ARRIVED: "وصل",
  COLLECTING: "جاري السحب",
  DELIVERED: "تم التسليم",
  CALLED: "تم النداء",
  SERVING: "قيد الخدمة",
  INVITED: "تمت الدعوة",
  EXPIRED: "منتهي",
  FAILED: "فشل",
  PASSED: "ناجح",
  DEAD_LETTER: "رسالة متعثرة",
  QUEUED: "في قائمة الانتظار",
  RECORDED: "مسجل",
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


const ENUM_AR: Record<string, string> = {
  PATIENT: "مريض",
  DOCTOR: "طبيب",
  CORPORATE: "شركة",
  INDIVIDUAL: "فرد",
  CLINIC: "عيادة",
  HOSPITAL: "مستشفى",
  COMPANY: "شركة",
  INSURANCE: "تأمين",
  PHYSICIAN: "طبيب",
  ONSITE: "داخل الفرع",
  HOME_COLLECTION: "سحب منزلي",
  RECEPTION: "الاستقبال",
  PHLEBOTOMY: "سحب الدم",
  GENERAL: "عام",
  MICROBIOLOGY: "أحياء دقيقة",
  NUMERIC: "رقمي",
  TEXT: "نصي",
  QUALITATIVE: "وصفي",
  BOOLEAN: "نعم / لا",
  DATE: "تاريخ",
  ANY: "أي",
  DAY: "يوم",
  WEEK: "أسبوع",
  MONTH: "شهر",
  YEAR: "سنة",
  ORGANIZATION: "المؤسسة",
  BRANCH: "فرع",
  CLIENT: "عميل",
  CONTRACT: "عقد",
  CASH: "نقدي",
  CARD: "بطاقة",
  BANK_TRANSFER: "تحويل بنكي",
  ONLINE: "إلكتروني",
  CREDIT_ACCOUNT: "حساب آجل",
  OTHER: "أخرى",
  PRINT: "طباعة",
  DOWNLOAD: "تنزيل",
  EMAIL: "بريد إلكتروني",
  SMS: "رسالة نصية",
  WHATSAPP: "واتساب",
  PORTAL: "البوابة",
  BILINGUAL: "ثنائي اللغة",
  ENGLISH: "إنجليزي",
  ARABIC: "عربي",
  CENTRAL_ONLY: "مركزي فقط",
  READ_ONLY: "للقراءة فقط",
  BUFFER_ONLY: "تخزين مؤقت فقط",
  ASTM: "ASTM",
  HL7_V2: "HL7 v2",
  SERIAL: "تسلسلي",
  TCP_CLIENT: "TCP عميل",
  TCP_SERVER: "TCP خادم",
  WATCH_FOLDER: "مجلد مراقبة",
  HTTP: "HTTP",
};

export function enumLabel(locale: UiLocale, value: string | null | undefined) {
  if (!value) return "—";
  return locale === "ar" ? STATUS_AR[value] || PRIORITY_AR[value] || SEX_AR[value] || ENUM_AR[value] || value : value;
}

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
