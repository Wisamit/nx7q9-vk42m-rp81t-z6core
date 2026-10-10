export type BundleDriftDisposition = "UNCHANGED" | "DRIFTED";

export type BundleDrift = {
  disposition: BundleDriftDisposition;
  changedFields: string[];
  additionalFieldsOmitted: boolean;
};

/**
 * Returns field names only; never emits source or live clinical/price values.
 * A change cannot be hidden by the display cap, depth cap, or unknown fields.
 */
export function catalogBundleDrift(source: unknown, live: unknown, maxFields = 24): BundleDrift {
  if (!Number.isSafeInteger(maxFields) || maxFields < 1 || maxFields > 100) {
    throw new Error("invalid_drift_field_limit");
  }
  const changedFields: string[] = [];
  let different = false;
  let additionalFieldsOmitted = false;
  let inspected = 0;
  const mark = (path: string) => {
    different = true;
    if (changedFields.length < maxFields) changedFields.push(path || "(root)");
    else additionalFieldsOmitted = true;
  };
  const record = (v: unknown): v is Record<string, unknown> =>
    Boolean(v && typeof v === "object" && !Array.isArray(v));
  const visit = (a: unknown, b: unknown, path: string, depth: number): void => {
    inspected++;
    if (depth > 16 || inspected > 30000) { mark(path); return; }
    if (Object.is(a, b)) return;
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b)) { mark(path); return; }
      if (a.length !== b.length) mark(path ? path + ".length" : "length");
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (!(i in a) || !(i in b)) {
          mark((path ? path + "." : "") + String(i));
        } else visit(a[i], b[i], (path ? path + "." : "") + String(i), depth + 1);
        if (inspected > 30000) break;
      }
      return;
    }
    if (record(a) || record(b)) {
      if (!record(a) || !record(b)) { mark(path); return; }
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const safeKey = /^[A-Za-z0-9_]{1,80}$/.test(key) ? key : "(other)";
        const nextPath = path ? path + "." + safeKey : safeKey;
        if (!Object.hasOwn(a, key) || !Object.hasOwn(b, key)) mark(nextPath);
        else visit(a[key], b[key], nextPath, depth + 1);
        if (inspected > 30000) break;
      }
      return;
    }
    mark(path);
  };
  visit(source, live, "", 0);
  return {
    disposition: different ? "DRIFTED" : "UNCHANGED",
    changedFields, additionalFieldsOmitted,
  };
}
