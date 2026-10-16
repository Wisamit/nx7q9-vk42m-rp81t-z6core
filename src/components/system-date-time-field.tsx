"use client";

import { useEffect, useRef, useState } from "react";
import { SystemDateField } from "@/components/system-date-field";
import { parseSystemLocalDateTime, composeSystemLocalDateTime } from "@/lib/system-date-time";

type Props = {
  name: string;
  defaultValue?: string | null;
  required?: boolean;
  disabled?: boolean;
  id?: string;
};

/**
 * Display a configured date and an explicit local clock time.
 * The named form value retains datetime-local's YYYY-MM-DDTHH:mm wire shape.
 * Converting this local wall time into UTC belongs to the existing endpoint
 * workflow and its selected branch timezone policy, not this display field.
 */
export function SystemDateTimeField({ name, defaultValue, required, disabled, id }: Props) {
  const initial = parseSystemLocalDateTime(defaultValue);
  const [dateIso, setDateIso] = useState(initial.date);
  const [clockTime, setClockTime] = useState(initial.time);
  const timeRef = useRef<HTMLInputElement>(null);
  const value = composeSystemLocalDateTime(dateIso, clockTime);

  useEffect(() => {
    const form = timeRef.current?.form;
    if (!form) return;
    const reset = () => {
      setDateIso(initial.date);
      setClockTime(initial.time);
    };
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [initial.date, initial.time]);

  return <span className="system-date-time-field">
    <SystemDateField defaultValue={initial.date} onIsoChange={setDateIso} required={required} disabled={disabled} />
    <input
      ref={timeRef}
      id={id}
      type="time"
      step="60"
      required={required}
      disabled={disabled}
      value={clockTime}
      aria-label="Local time / التوقيت المحلي"
      onChange={event => setClockTime(event.target.value)}
    />
    <input type="hidden" name={name} value={value} disabled={disabled} />
  </span>;
}
