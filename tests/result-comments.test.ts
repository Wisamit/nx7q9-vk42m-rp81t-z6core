import test from "node:test";
import assert from "node:assert/strict";
import {
  commentTemplateTargetMatches,
  normalizeResultComment,
  resolveResultValueComment,
} from "../src/lib/result-comments.ts";

test("component comments preserve existing text when bulk entry omits the field", () => {
  assert.equal(resolveResultValueComment(undefined, "Keep this"), "Keep this");
  assert.equal(resolveResultValueComment({} as { comments?: unknown }, "Keep this"), "Keep this");
});

test("component comments can be explicitly cleared or replaced", () => {
  assert.equal(resolveResultValueComment({ comments: "   " }, "Old comment"), null);
  assert.equal(resolveResultValueComment({ comments: "  New comment  " }, "Old comment"), "New comment");
  assert.equal(normalizeResultComment("  A  "), "A");
});

test("comment templates cannot leak across result and component scopes", () => {
  const organization = { scope: "ORGANIZATION" as const, testId: null, componentId: null };
  const test = { scope: "TEST" as const, testId: "T1", componentId: null };
  const component = { scope: "COMPONENT" as const, testId: "T1", componentId: "C1" };

  assert.equal(commentTemplateTargetMatches(organization, "T1", null), true);
  assert.equal(commentTemplateTargetMatches(organization, "T1", "C1"), false);

  assert.equal(commentTemplateTargetMatches(test, "T1", null), true);
  assert.equal(commentTemplateTargetMatches(test, "T2", null), false);
  assert.equal(commentTemplateTargetMatches(test, "T1", "C1"), false);

  assert.equal(commentTemplateTargetMatches(component, "T1", "C1"), true);
  assert.equal(commentTemplateTargetMatches(component, "T1", "C2"), false);
  assert.equal(commentTemplateTargetMatches(component, "T2", "C1"), false);
  assert.equal(commentTemplateTargetMatches(component, "T1", null), false);
});
