"use client";

import { useState } from "react";
import { CrudModal } from "@/components/crud-modal";
import { SystemIcon } from "@/components/system-icon";
import { SystemSettingsForm } from "@/components/system-settings-form";
import type { SystemSettings } from "@/lib/system-settings";

/**
 * Keep organization settings readable without exposing an inline mutation
 * form. Editing is an explicit action inside the same accessible modal
 * pattern as the rest of the admin UI.
 */
export function SystemSettingsDialog({
  initial,
  locale,
}: {
  initial: SystemSettings;
  locale: "ar" | "en";
}) {
  const [open, setOpen] = useState(false);
  const ar = locale === "ar";
  const label = (en: string, arabic: string) => ar ? arabic : en;
  const themeName = initial.defaultTheme === "SYSTEM"
    ? label("System", "حسب الجهاز")
    : initial.defaultTheme === "LIGHT"
      ? label("Light", "فاتح")
      : label("Dark", "داكن");

  return <>
    <section className="settings-card">
      <div className="settings-card-title">
        <SystemIcon name="palette" />
        <div>
          <h2>{label("Current organization preferences", "إعدادات المؤسسة الحالية")}</h2>
          <p>{label(
            "Review active defaults before opening the settings editor.",
            "راجع الإعدادات الحالية قبل فتح نافذة التعديل.",
          )}</p>
        </div>
      </div>
      <div className="settings-grid">
        <div><strong>{label("Organization", "المؤسسة")}</strong><p>{ar ? initial.organizationNameAr || initial.organizationNameEn : initial.organizationNameEn}</p></div>
        <div><strong>{label("Timezone", "المنطقة الزمنية")}</strong><p dir="ltr">{initial.timezone}</p></div>
        <div><strong>{label("Display formats", "تنسيقات العرض")}</strong><p dir="ltr">{initial.dateFormat} · {initial.timeFormat === "12" ? "12h" : "24h"}</p></div>
        <div><strong>{label("Appearance", "المظهر")}</strong><p>{themeName}</p></div>
      </div>
      <div className="crud-trigger-row">
        <button type="button" className="primary-button" onClick={() => setOpen(true)}>
          <SystemIcon name="palette" size={16} />
          {label("Edit system settings", "تعديل إعدادات النظام")}
        </button>
      </div>
    </section>
    <CrudModal
      open={open}
      onClose={() => setOpen(false)}
      size="compact"
      title={label("Edit organization settings", "تعديل إعدادات المؤسسة")}
      description={label(
        "Identity, timezone, display formats and theme. Changes apply organization-wide.",
        "الهوية والمنطقة الزمنية وتنسيقات العرض والألوان. تسري التغييرات على المؤسسة.",
      )}
    >
      {open && <SystemSettingsForm initial={initial} locale={locale} />}
    </CrudModal>
  </>;
}
