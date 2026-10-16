"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { SystemIcon } from "@/components/system-icon";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

type CrudModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full" | "compact";
  protectUnsavedChanges?: boolean;
};

/**
 * Mounts a fresh dialog session on every open. An external close caused by a
 * successful save therefore cannot leave a stale discard confirmation open
 * on the next edit attempt.
 */
export function CrudModal(props: CrudModalProps) {
  if (!props.open) return null;
  return <OpenCrudModal {...props} />;
}

function OpenCrudModal({
  onClose,
  title,
  description,
  children,
  size = "md",
  protectUnsavedChanges = true,
}: CrudModalProps) {
  const headingId = useId();
  const descriptionId = useId();
  const discardTitleId = useId();
  const discardDescriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const discardRef = useRef<HTMLDivElement>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const focusBeforeDiscardRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  const changedRef = useRef(false);
  const discardOpenRef = useRef(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardArabic, setDiscardArabic] = useState(false);

  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => { discardOpenRef.current = discardOpen; }, [discardOpen]);

  const requestClose = useCallback(() => {
    if (discardOpenRef.current) return;
    if (protectUnsavedChanges && changedRef.current) {
      focusBeforeDiscardRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement : null;
      setDiscardArabic(
        document.documentElement.lang.toLowerCase().startsWith("ar") ||
        document.documentElement.dir === "rtl"
      );
      discardOpenRef.current = true;
      setDiscardOpen(true);
      return;
    }
    // The caller can still reject dismissal while a mutation is running.
    // Do not clear dirty state until the dialog actually closes.
    closeRef.current();
  }, [protectUnsavedChanges]);

  const cancelDiscard = useCallback(() => {
    discardOpenRef.current = false;
    setDiscardOpen(false);
    const target = focusBeforeDiscardRef.current;
    if (target?.isConnected) target.focus({ preventScroll: true });
    else dialogRef.current?.focus({ preventScroll: true });
  }, []);

  const confirmDiscard = useCallback(() => {
    discardOpenRef.current = false;
    setDiscardOpen(false);
    // The parent may refuse to close while an API write is in progress.
    // Changed input remains dirty until the next actual open=false cleanup.
    closeRef.current();
  }, []);

  useEffect(() => {
    if (!discardOpen) return;
    const frame = requestAnimationFrame(() => keepEditingRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [discardOpen]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => dialogRef.current?.focus({ preventScroll: true }));

    function onKey(event: KeyboardEvent) {
      const dialog = dialogRef.current;
      if (!dialog) return;
      // Only the topmost dialog responds when dialogs are nested.
      const dialogs = document.querySelectorAll<HTMLElement>("[data-crud-modal='true']");
      if (dialogs[dialogs.length - 1] !== dialog) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (discardOpenRef.current) cancelDiscard();
        else requestClose();
        return;
      }
      if (event.key !== "Tab") return;

      // When the unsaved changes alert is visible, the underlying form is
      // deliberately excluded from the keyboard focus boundary.
      const trap = discardOpenRef.current ? discardRef.current : dialog;
      if (!trap) return;
      const focusable = Array.from(trap.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter(element => element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility !== "hidden");
      if (!focusable.length) {
        event.preventDefault();
        trap.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0], last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === trap || !trap.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || active === trap || !trap.contains(active))) {
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
  }, [requestClose, cancelDiscard]);

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
      {discardOpen && <div className="crud-modal-discard-shade" role="presentation">
        <div
          className="crud-modal-discard-panel"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={discardTitleId}
          aria-describedby={discardDescriptionId}
          ref={discardRef}
          tabIndex={-1}
        >
          <h3 id={discardTitleId}>
            {discardArabic ? "تغييرات غير محفوظة" : "Unsaved changes"}
          </h3>
          <p id={discardDescriptionId}>
            {discardArabic
              ? "لديك تغييرات غير محفوظة. هل تريد تجاهلها وإغلاق النافذة؟"
              : "You have unsaved changes. Discard them and close this dialog?"}
          </p>
          <div className="crud-modal-discard-actions">
            <button type="button" className="secondary-button" ref={keepEditingRef}
              onClick={cancelDiscard}>
              {discardArabic ? "متابعة التعديل" : "Keep editing"}
            </button>
            <button type="button" className="primary-button" onClick={confirmDiscard}>
              {discardArabic ? "تجاهل التغييرات" : "Discard changes"}
            </button>
          </div>
        </div>
      </div>}
    </section>
  </div>;
}
