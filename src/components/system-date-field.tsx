"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { subscribeRootDatePreferences } from "@/lib/root-date-preferences";
import { createSystemDateDraft, resolveSystemDateDraft, type SystemDateDraft } from "@/lib/system-date-draft";
import { SystemIcon } from "@/components/system-icon";
import {
  dateInputExample, formatSystemDate, normalizeSystemDateFormat,
  parseSystemDateInput, type SystemDateFormat,
} from "@/lib/system-date";

type SystemDateFieldProps = {
  name?: string;
  onIsoChange?: (iso: string) => void;
  defaultValue?: string | null;
  required?: boolean;
  disabled?: boolean;
  min?: string;
  max?: string;
  id?: string;
  className?: string;
};

const subscribeToRootDateFormat = subscribeRootDatePreferences;
const readRootDateFormat = (): SystemDateFormat =>
  normalizeSystemDateFormat(document.documentElement.dataset.dateFormat);
const serverDateFormat = (): SystemDateFormat => "DD/MM/YYYY";

/**
 * Date-only editor: visible text follows organization settings, while the
 * named FormData field and calendar picker always carry YYYY-MM-DD.
 * Do not convert date-only patient, finance or QC values through UTC offsets.
 */
export function SystemDateField({
  name, defaultValue, required, disabled, min, max, id, className, onIsoChange,
}: SystemDateFieldProps) {
  const initialIso = parseSystemDateInput(defaultValue || "", "YYYY-MM-DD") || "";
  const format = useSyncExternalStore(subscribeToRootDateFormat, readRootDateFormat, serverDateFormat);
  const [draft, setDraft] = useState<SystemDateDraft | null>(null);
  const { text, validIso } = resolveSystemDateDraft(initialIso, draft, format, min, max);
  const inputRef = useRef<HTMLInputElement>(null);
  const calendarRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const onReset = () => {
      setDraft(null);
      onIsoChange?.(initialIso);
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [initialIso, onIsoChange]);

  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.setCustomValidity(
      !text || validIso ? "" : "Invalid date for the selected system format / تاريخ غير صالح حسب تنسيق النظام",
    );
  }, [text, validIso]);

  function changeText(next: string, element: HTMLInputElement) {
    const candidate = createSystemDateDraft(next, format);
    setDraft(candidate);
    const resolved = resolveSystemDateDraft(initialIso, candidate, format, min, max);
    onIsoChange?.(resolved.validIso);
    element.setCustomValidity(resolved.invalid
      ? "Invalid date for the selected system format / تاريخ غير صالح حسب تنسيق النظام"
      : "");
  }

  function openPicker() {
    const calendar = calendarRef.current;
    if (!calendar) return;
    try {
      if (typeof calendar.showPicker === "function") calendar.showPicker();
      else calendar.focus();
    } catch {
      inputRef.current?.focus();
    }
  }

  return <span className={"system-date-field" + (className ? " " + className : "")} data-date-format={format}>
    <input
      ref={inputRef}
      id={id}
      type="text"
      inputMode={format === "DD MMM YYYY" ? "text" : "numeric"}
      dir="ltr"
      lang="en"
      autoComplete="off"
      required={required}
      disabled={disabled}
      value={text}
      placeholder={format}
      title={dateInputExample(format)}
      aria-invalid={Boolean(text && !validIso)}
      onChange={event => changeText(event.target.value, event.target)}
    />
    {name && <input type="hidden" name={name} value={validIso} disabled={disabled} />}
    <input
      ref={calendarRef}
      type="date"
      className="system-date-native-picker"
      aria-hidden="true"
      tabIndex={-1}
      value={validIso}
      min={min}
      max={max}
      disabled={disabled}
      onChange={event => {
        const next = event.target.value;
        const selected = next ? formatSystemDate(next, format) : "";
        setDraft(createSystemDateDraft(selected, format));
        onIsoChange?.(next);
        inputRef.current?.setCustomValidity("");
      }}
    />
    <button
      type="button"
      className="system-date-picker-trigger"
      aria-label="Choose calendar date / اختيار تاريخ من التقويم"
      title="Choose calendar date / اختيار تاريخ من التقويم"
      disabled={disabled}
      onClick={openPicker}
    ><SystemIcon name="calendar" size={17} /></button>
  </span>;
}
