"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import { SystemIcon } from "@/components/system-icon";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

export function CrudModal({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
  protectUnsavedChanges = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full" | "compact";
  protectUnsavedChanges?: boolean;
}) {
  const headingId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const changedRef = useRef(false);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  const requestClose = useCallback(() => {
    if (protectUnsavedChanges && changedRef.current) {
      const arabic = document.documentElement.lang.toLowerCase().startsWith("ar") ||
        document.documentElement.dir === "rtl";
      const message = arabic
        ? "لديك تغييرات غير محفوظة. هل تريد تجاهلها وإغلاق النافذة؟"
        : "You have unsaved changes. Discard them and close this dialog?";
      if (!window.confirm(message)) return;
    }
    changedRef.current = false;
    closeRef.current();
  }, [protectUnsavedChanges]);

  useEffect(() => {
    if (!open) {
      changedRef.current = false;
      return;
    }

    // A modal is a true keyboard focus boundary, not just a visual overlay.
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => dialogRef.current?.focus({ preventScroll: true }));

    function onKey(event: KeyboardEvent) {
      const dialog = dialogRef.current;
      if (!dialog) return;
      // Only the topmost dialog handles global key events.
      const dialogs = document.querySelectorAll<HTMLElement>("[data-crud-modal='true']");
      if (dialogs[dialogs.length - 1] !== dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        requestClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter(element => element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility !== "hidden");
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0], last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || active === dialog || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [open, requestClose]);

  if (!open) return null;

  return <div className="crud-modal-backdrop" role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget) requestClose();
  }}>
    <section
      ref={dialogRef}
      data-crud-modal="true"
      tabIndex={-1}
      className={"crud-modal crud-modal-" + size}
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      aria-describedby={description ? descriptionId : undefined}
      onInputCapture={() => { changedRef.current = true; }}
      onChangeCapture={() => { changedRef.current = true; }}
    >
      <header className="crud-modal-header">
        <div>
          <h2 id={headingId}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}
        </div>
        <button type="button" className="icon-button" aria-label="Close / إغلاق" onClick={requestClose}>
          <SystemIcon name="close" size={18} />
        </button>
      </header>
      <div className="crud-modal-body">{children}</div>
    </section>
  </div>;
}
