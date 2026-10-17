import { formatSystemDate, parseSystemDateInput, type SystemDateFormat } from "./system-date.ts";

export type SystemDateDraft = {
  text: string;
  entryFormat: SystemDateFormat;
  iso: string | null;
};

export function createSystemDateDraft(text: string, format: SystemDateFormat): SystemDateDraft {
  return { text, entryFormat: format, iso: parseSystemDateInput(text, format) };
}

/**
 * Retain the ISO date resolved using the user's original entry format.
 * Re-reading that same text as a new DD/MM vs MM/DD setting would silently
 * change a patient DOB, clinical effective date, or financial period.
 * Incomplete/invalid drafts remain invalid instead of being reinterpreted.
 */
export function resolveSystemDateDraft(
  initialIso: string,
  draft: SystemDateDraft | null,
  displayFormat: SystemDateFormat,
  min?: string,
  max?: string,
): { text: string; validIso: string; invalid: boolean } {
  const iso = draft ? draft.iso : parseSystemDateInput(initialIso, "YYYY-MM-DD");
  const text = draft
    ? draft.entryFormat === displayFormat || !iso
      ? draft.text
      : formatSystemDate(iso, displayFormat)
    : iso ? formatSystemDate(iso, displayFormat) : "";
  const outside = Boolean(iso && ((min && iso < min) || (max && iso > max)));
  const validIso = iso && !outside ? iso : "";
  return { text, validIso, invalid: Boolean(text && !validIso) };
}
