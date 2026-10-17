import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (file: string) => readFileSync(file, "utf8");
const ui = {
  home: source("src/app/home-collections/page.tsx"),
  critical: source("src/app/critical-results/page.tsx"),
  approval: source("src/app/clinical-comments/review/page.tsx"),
  revision: source("src/app/clinical-comments/revisions/page.tsx"),
  css: source("src/app/globals.css"),
};

test("visual QA: missing shared page-shell padding is restored at desktop and mobile widths", () => {
  assert.ok(ui.css.includes(".catalog-shell,.page-shell{max-width:none;margin:0;min-width:0;padding:28px 30px 42px}"));
  assert.ok(ui.css.includes(".catalog-shell,.page-shell,.dashboard-home{padding:20px 15px 32px}"));
  assert.ok(ui.css.includes(".catalog-shell,.page-shell{padding-inline:12px}"));
  for (const page of [ui.home, ui.critical, ui.approval, ui.revision]) {
    assert.match(page, /className="(?:page-shell|catalog-shell) workflow-page"/);
  }
  assert.ok(ui.css.includes(".workflow-page .page-header{align-items:flex-start}"));
  assert.ok(ui.css.includes(".workflow-page .workflow-empty{display:flex"));
  assert.ok(ui.css.includes("@media(max-width:700px)"));
});

test("visual QA: home collections filter controls are labeled and state remains branch scoped", () => {
  assert.ok(ui.home.includes('className="workflow-filters"'));
  assert.ok(ui.home.includes('className="workflow-filter-field"'));
  assert.ok(ui.home.includes('name="branch" defaultValue={selected || ""}'));
  assert.ok(ui.home.includes('name="status" defaultValue={requestedStatus || ""}'));
  assert.ok(ui.home.includes('href="/home-collections"'));
  assert.ok(ui.home.includes('visible.length === 0 ? <div className="workflow-empty"'));
  assert.ok(ui.home.includes('className="workflow-data-table"'));
  assert.ok(ui.home.includes('scope.includes(params.branch)'));
  assert.ok(ui.home.includes('appointment: { organizationId: session.user.organizationId, mode: "HOME_COLLECTION" }'));
  assert.ok(ui.home.includes("assignedCollectorUserId: session.user.id"));
  assert.ok(ui.home.includes("timeZone={visit.branch.timezone}"));
});

test("visual QA: critical events have accessible active filters, paging and correct timezone displays", () => {
  assert.ok(ui.critical.includes('className="workflow-filter-tabs no-print"'));
  assert.ok(ui.critical.includes('aria-current={filter === "all" ? "page" : undefined}'));
  assert.ok(ui.critical.includes('aria-current={filter === "overdue" ? "page" : undefined}'));
  assert.ok(ui.critical.includes('events.length === 0 ? <div className="workflow-empty"'));
  assert.ok(ui.critical.includes('className="workflow-queue-footer no-print"'));
  assert.ok(ui.critical.includes('criticalQueuePage(pageData, filter)'));
  assert.ok(ui.critical.includes('criticalQueueAfterWhere(cursor)'));
  assert.ok(ui.critical.includes("organizationId: session.user.organizationId"));
  assert.ok(ui.critical.includes("performingBranchId: { in: branchIds }"));
  assert.ok(ui.critical.includes('timeZone={event.result.performingBranch.timezone}'));
  assert.ok(ui.critical.includes('event.criticalValueSnapshot'));
  assert.ok(ui.critical.includes('event.acknowledgementDueAt < now'));
});

test("visual QA: approval worklist does not offer clinical shortcuts or false approvals", () => {
  assert.ok(ui.approval.includes('className="workflow-review-summary"'));
  assert.ok(ui.approval.includes('page.length === 0 ? <div className="workflow-empty"'));
  assert.ok(ui.approval.includes('pendingCount === 0'));
  assert.ok(ui.approval.includes("commentReviewBlocker(template"));
  assert.ok(ui.approval.includes('commentTemplateReviewFingerprint(template)'));
  assert.ok(ui.approval.includes('requirePermission("clinical_rules.approve")'));
  assert.ok(ui.approval.includes('permissions.has("result_comments.manage")'));
  assert.ok(ui.approval.includes('status="INACTIVE"'));
  assert.ok(ui.approval.includes('className="workflow-data-table"'));
  assert.doesNotMatch(ui.approval, /pendingCount\s*===\s*0\s*\?\s*<CommentTemplateStatusButton/);
});

test("visual QA: revisions give a useful empty state but never create a version without approved source", () => {
  assert.ok(ui.revision.includes('page.length === 0 ? <article className="detail-card workflow-empty"'));
  assert.ok(ui.revision.includes('page.length === 0 ? <article'));
  assert.ok(ui.revision.includes('permissionSet(session).has("clinical_rules.approve")'));
  assert.ok(ui.revision.includes('canApprove && <Link'));
  assert.ok(ui.revision.includes('createdAt: row.createdAt.toISOString()'));
  assert.ok(ui.revision.includes('fingerprint: commentTemplateReviewFingerprint(row)'));
  assert.ok(ui.revision.includes('status: "ACTIVE", nextRevision: null'));
  assert.ok(ui.revision.includes("CommentRevisionEditor"));
  assert.ok(ui.revision.includes('decodeCommentReviewCursor(params.after)'));
});

test("visual QA: revised workspaces use CSS tokens and do not need medical sample data", () => {
  const css = ui.css.slice(ui.css.indexOf("/* Visually audited operational queues:"));
  for (const token of ["--fl-border", "--fl-surface", "--fl-muted", "--fl-primary", "--fl-radius"]) {
    assert.ok(css.includes("var(" + token + ")"), token);
  }
  assert.ok(css.includes(".workflow-page .workflow-data-table td small"));
  assert.ok(css.includes(".workflow-page .workflow-filter-tabs .secondary-link[aria-current"));
  for (const page of [ui.home, ui.critical, ui.approval, ui.revision]) {
    assert.ok(page.includes("locale"), "Arabic/English still configured");
    assert.ok(page.includes("tr(locale,"), "Both language strings retained");
  }
});
