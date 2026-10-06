"use client";

import { useEffect } from "react";
import { SystemIcon } from "@/components/system-icon";

export function CrudModal({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return <div className="crud-modal-backdrop" role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className={"crud-modal crud-modal-" + size} role="dialog" aria-modal="true" aria-labelledby="crud-modal-title">
      <header className="crud-modal-header">
        <div>
          <h2 id="crud-modal-title">{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}><SystemIcon name="close" size={18} /></button>
      </header>
      <div className="crud-modal-body">{children}</div>
    </section>
  </div>;
}
