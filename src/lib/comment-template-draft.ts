export type ClinicalCommentDraft = {
  scope: "ORGANIZATION" | "TEST" | "COMPONENT";
  testId: string | null;
  componentId: string | null;
  code: string;
  nameEn: string;
  nameAr: string | null;
  textEn: string;
  textAr: string | null;
};

export class ClinicalCommentDraftError extends Error {
  readonly reason: string;
  constructor(reason: string) { super(reason); this.reason = reason; }
}

export function parseClinicalCommentDraft(body: unknown): ClinicalCommentDraft {
  const fail = (message: string): never => { throw new ClinicalCommentDraftError(message); };
  if (body === null || typeof body !== "object" || Array.isArray(body)) return fail("invalid_request");
  const obj = body as Record<string, unknown>;
  const optional = (field: string, max: number): string | null => {
    if (obj[field] == null || obj[field] === "") return null;
    if (typeof obj[field] !== "string") return fail("invalid_" + field);
    const value = (obj[field] as string).trim();
    if (value.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
      return fail("invalid_" + field);
    }
    return value || null;
  };
  const scope = obj.scope;
  if (scope !== "ORGANIZATION" && scope !== "TEST" && scope !== "COMPONENT") {
    return fail("invalid_comment_scope");
  }
  const nameEn = optional("nameEn",220);
  const nameAr = optional("nameAr",220);
  const textEn = optional("textEn",5000);
  const textAr = optional("textAr",5000);
  const testId = optional("testId",36);
  const componentId = optional("componentId",36);
  const codeInput = optional("code",80);
  if (!nameEn || !textEn) return fail("missing_required_fields");
  const normalizedCode = codeInput || nameEn.toUpperCase().replace(/[^A-Z0-9]+/g,"_").replace(/^_+|_+$/g,"");
  if (!/^[A-Z0-9][A-Z0-9_]{0,79}$/.test(normalizedCode)) return fail("invalid_comment_code");
  if ((testId && !/^[a-f0-9-]{36}$/i.test(testId)) ||
      (componentId && !/^[a-f0-9-]{36}$/i.test(componentId))) {
    return fail("invalid_comment_target_id");
  }
  if (scope === "ORGANIZATION" && (testId || componentId)) return fail("organization_scope_must_not_have_target");
  if (scope === "TEST" && (!testId || componentId)) return fail("test_scope_requires_only_test");
  if (scope === "COMPONENT" && (!testId || !componentId)) return fail("component_scope_requires_both_targets");
  return { scope, testId, componentId, code: normalizedCode, nameEn,
    nameAr, textEn, textAr };
}
