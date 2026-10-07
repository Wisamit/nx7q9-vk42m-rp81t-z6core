export function shouldAdvanceResultEntryOnEnter(input: {
  key: string;
  shiftKey?: boolean;
  isComposing?: boolean;
}) {
  return input.key === "Enter" && input.shiftKey !== true && input.isComposing !== true;
}

export function focusNextResultEntryControl(current: HTMLElement) {
  const form = current.closest("form");
  if (!form) return false;

  const controls = Array.from(
    form.querySelectorAll<HTMLElement>('[data-result-entry-control="true"]:not([disabled])'),
  ).filter((control) => control.getAttribute("aria-hidden") !== "true");

  const currentIndex = controls.indexOf(current);
  if (currentIndex < 0 || currentIndex >= controls.length - 1) return false;

  controls[currentIndex + 1]?.focus();
  return true;
}
