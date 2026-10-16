"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SystemIcon } from "@/components/system-icon";
import {
  dateInputExample, formatSystemDate, normalizeSystemDateFormat,
  parseSystemDateInput, type SystemDateFormat,
} from "@/lib/system-date";

type SystemDateFieldProps = {
  name: string;
  defaultValue?: string | null;
  required?: boolean;
  disabled?: boolean;
  min?: string;
  max?: string;
  id?: string;
  className?: string;
};

const subscribeToRootDateFormat = () => () => {};
const readRootDateFormat = (): SystemDateFormat =>
  normalizeSystemDateFormat(document.documentElement.dataset.dateFormat);
const serverDateFormat = (): SystemDateFormat => "DD/MM/YYYY";

/**
 * Date-only editor: visible text follows organization settings, while the
 * named FormData field and calendar picker always carry YYYY-MM-DD.
 * Do not convert date-only patient, finance or QC values through UTC offsets.
 */
export function SystemDateField({
  name, defaultValue, required, disabled, min, max, id, className,
}: SystemDateFieldProps) {
  const initialIso = parseSystemDateInput(defaultValue || "", "YYYY-MM-DD") || "";
  const format = useSyncExternalStore(subscribeToRootDateFormat, readRootDateFormat, serverDateFormat);
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? formatSystemDate(initialIso, format);
  const inputRef = useRef<HTMLInputElement>(null);
  const calendarRef = useRef<HTMLInputElement>(null);
  const iso = parseSystemDateInput(text, format) || "";
  const outsideRange = Boolean(iso && ((min && iso < min) || (max && iso > max)));
  const validIso = outsideRange ? "" : iso;

  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const onReset = () => setDraft(null);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.setCustomValidity(
      !text || validIso ? "" : "Invalid date for the selected system format / تاريخ غير صالح حسب تنسيق النظام",
    );
  }, [text, validIso]);

  function changeText(next: string, element: HTMLInputElement) {
    setDraft(next);
    const parsed = parseSystemDateInput(next, format);
    const outOfRange = Boolean(parsed && ((min && parsed < min) || (max && parsed > max)));
    element.setCustomValidity(!next || (parsed && !outOfRange)
      ? "" : "Invalid date for the selected system format / تاريخ غير صالح حسب تنسيق النظام");
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
    <input type="hidden" name={name} value={validIso} disabled={disabled} />
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
        setDraft(next ? formatSystemDate(next, format) : "");
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
