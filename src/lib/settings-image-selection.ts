/** Track only the currently selected image reader for each settings field.
 * Earlier FileReader completions must never restore a superseded selection.
 * All methods are synchronous, so submit handlers can check pending reads
 * even before React has rerendered a disabled Save button.
 */
export type SettingsImageKey = "logoDataUrl" | "faviconDataUrl";

export function createSettingsImageSelectionGate() {
  const generation: Record<SettingsImageKey, number> = {
    logoDataUrl: 0,
    faviconDataUrl: 0,
  };
  const pending = new Set<SettingsImageKey>();

  return {
    begin(key: SettingsImageKey): number {
      generation[key] += 1;
      pending.add(key);
      return generation[key];
    },
    complete(key: SettingsImageKey, version: number): boolean {
      if (generation[key] !== version) return false;
      pending.delete(key);
      return true;
    },
    cancel(key: SettingsImageKey): void {
      generation[key] += 1;
      pending.delete(key);
    },
    hasPending(): boolean {
      return pending.size > 0;
    },
  };
}
