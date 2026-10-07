export type ResultCommentInput = {
  comments?: unknown;
};

export function normalizeResultComment(value: unknown, max = 5000) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().slice(0, max);
  return normalized || null;
}

export function resolveResultValueComment(
  entry: ResultCommentInput | undefined,
  existingComment: string | null | undefined,
) {
  if (entry && Object.prototype.hasOwnProperty.call(entry, "comments")) {
    return normalizeResultComment(entry.comments);
  }
  return existingComment || null;
}

export type ResultCommentTemplateScope = "ORGANIZATION" | "TEST" | "COMPONENT";

export function commentTemplateTargetMatches(
  template: { scope: ResultCommentTemplateScope; testId: string | null; componentId: string | null },
  testId: string,
  componentId: string | null,
) {
  if (template.scope === "ORGANIZATION") return componentId === null;
  if (template.scope === "TEST") return template.testId === testId && componentId === null;
  return template.testId === testId && template.componentId === componentId && componentId !== null;
}
