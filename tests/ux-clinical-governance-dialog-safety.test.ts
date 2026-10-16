import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

type Spec = {
  file: string;
  entries: Array<{
    key: string; handler: string; endpoint: string; route: string;
    fields: string[]; extra?: string[];
    approvalAction: string;
  }>;
};

const specs: Spec[] = [
  { file: "src/components/clinical-rules-manager.tsx", entries: [
    {
      key: "delta", handler: "createDelta", endpoint: "/api/clinical-rules/delta",
      route: "src/app/api/clinical-rules/delta/route.ts",
      fields: ["testId", "componentId", "branchId", "methodId",
        "absoluteLimit", "percentLimit", "lookbackDays", "effectiveFrom", "effectiveTo"],
      approvalAction: "DELTA_RULE_DRAFT_CREATED",
    },
    {
      key: "comment", handler: "createComment", endpoint: "/api/clinical-rules/comments",
      route: "src/app/api/clinical-rules/comments/route.ts",
      fields: ["testId", "componentId", "code", "nameEn", "nameAr", "textEn", "textAr"],
      extra: ["scope: commentScope"],
      approvalAction: "COMMENT_TEMPLATE",
    },
  ]},
  { file: "src/components/advanced-clinical-rules-manager.tsx", entries: [
    {
      key: "calculated", handler: "createCalculated", endpoint: "/api/clinical-rules/calculated",
      route: "src/app/api/clinical-rules/calculated/route.ts",
      fields: ["testId", "targetComponentId", "expression", "decimalPrecision",
        "effectiveFrom", "effectiveTo"],
      approvalAction: "CALCULATED_RESULT_RULE_DRAFT_CREATED",
    },
    {
      key: "reflex", handler: "createReflex", endpoint: "/api/clinical-rules/reflex",
      route: "src/app/api/clinical-rules/reflex/route.ts",
      fields: ["sourceTestId", "sourceComponentId", "branchId", "numericThreshold",
        "textThreshold", "targetTestId", "noteEn", "noteAr", "effectiveFrom", "effectiveTo"],
      extra: ["operator,"],
      approvalAction: "REFLEX_RULE_DRAFT_CREATED",
    },
  ]},
  { file: "src/components/autoverification-validation-manager.tsx", entries: [
    {
      key: "policy", handler: "createPolicy", endpoint: "/api/clinical-rules/autoverification",
      route: "src/app/api/clinical-rules/autoverification/route.ts",
      fields: ["testId", "branchId", "enabled", "allowManual", "allowAnalyzer", "allowImport",
        "requireAllFlagsNormal", "effectiveFrom", "effectiveTo"],
      approvalAction: "AUTOVERIFICATION_POLICY_DRAFT_CREATED",
    },
    {
      key: "hold", handler: "createHold", endpoint: "/api/clinical-rules/validation-holds",
      route: "src/app/api/clinical-rules/validation-holds/route.ts",
      fields: ["testId", "branchId", "severity", "reasonEn", "reasonAr",
        "effectiveFrom", "effectiveTo"],
      extra: ["condition,", "resultSource: condition === \"RESULT_SOURCE\""],
      approvalAction: "VALIDATION_HOLD_RULE_DRAFT_CREATED",
    },
  ]},
];

test("Issue #265: all six clinical authoring forms are reachable only from compact guarded dialogs", () => {
  for (const spec of specs) {
    const src = readFileSync(spec.file, "utf8");
    assert.match(src, /import \{ CrudModal \} from "@\/components\/crud-modal"/);
    assert.doesNotMatch(src, /event\.currentTarget\.reset\(\)/,
      "form must never lose user inputs after a failed server response");
    for (const item of spec.entries) {
      const prefix = '<CrudModal open={open === "' + item.key + '"}';
      const modalStart = src.indexOf(prefix);
      assert.ok(modalStart >= 0, spec.file + " " + item.key + " has a modal");
      const modalEnd = src.indexOf("</CrudModal>", modalStart);
      const formStart = src.indexOf('<form className="catalog-form" onSubmit={' + item.handler + '}>', modalStart);
      assert.ok(modalEnd > formStart && formStart > modalStart,
        spec.file + " " + item.key + " form must be nested inside its own modal");
      const section = src.slice(modalStart, modalEnd);
      assert.ok(section.includes('size="compact"'));
      assert.ok(section.includes('if (!busy) setOpen("")'),
        "in-flight clinical draft must not close during mutation");
      assert.ok(section.includes('open === "' + item.key + '" && <form'),
        "closed clinical forms must not stay mounted in the page");
      assert.ok(section.includes('role="alert"'),
        "submission errors must be visible inside the modal");
      const trigger = src.slice(Math.max(0, modalStart - 400), modalStart);
      assert.ok(trigger.includes('type="button"') && trigger.includes('setOpen("' + item.key + '")'));
    }
  }
});

test("Issue #265: clinical draft POST payloads, tenant permissions and inactive approval boundary preserved", () => {
  for (const spec of specs) {
    const src = readFileSync(spec.file, "utf8");
    for (const item of spec.entries) {
      const handlerStart = src.indexOf("async function " + item.handler + "(");
      const handlerEnd = src.indexOf("\n  }", handlerStart);
      assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, item.handler);
      const handler = src.slice(handlerStart, handlerEnd);
      assert.ok(handler.includes('fetch("' + item.endpoint + '"'));
      assert.ok(handler.includes('method: "POST"'));
      assert.ok(handler.includes('new FormData(event.currentTarget)'));
      assert.ok(handler.includes("if (busy) return;"));
      assert.ok(handler.includes("if (!response.ok)"));
      assert.ok(handler.includes("setFormError("));
      assert.ok(handler.includes('setOpen("")'));
      assert.ok(handler.includes("router.refresh()"));
      assert.ok(handler.includes("finally {"));
      for (const field of item.fields) {
        assert.ok(handler.includes(field + ': form.get("' + field + '")') ||
          handler.includes(field + ': form.get("' + field + '") === "on"'),
          item.handler + " must preserve exact field " + field);
      }
      for (const extra of item.extra || []) assert.ok(handler.includes(extra), item.handler + " missing " + extra);
      const api = readFileSync(item.route, "utf8");
      assert.ok(api.includes('status: "INACTIVE"'), item.endpoint + " must stage inactive");
      assert.ok(api.includes("tx.auditEvent.create"), item.endpoint + " must audit");
      assert.ok(api.includes(item.approvalAction), item.endpoint + " must have provenance");
      if (item.endpoint.endsWith("/comments")) {
        assert.ok(api.includes('requirePermission("result_comments.manage")'));
      } else {
        assert.ok(api.includes('requirePermission("clinical_rules.manage")'));
      }
    }
  }
});

test("Issue #265: clinical rules route is inventoried and static browser status remains unexecuted", () => {
  const inventory = JSON.parse(execFileSync(process.execPath,
    ["scripts/ui-route-form-inventory.mjs", "--json"],
    { encoding: "utf8", maxBuffer: 12 * 1024 * 1024 })) as {
      routes: Array<{route: string; potentialInlineMutations: Array<{file: string}>;
        browserReviewStatus: string }>;
    };
  const route = inventory.routes.find(item => item.route === "/clinical-rules");
  assert.ok(route, "Clinical rules route must be tracked");
  for (const spec of specs) {
    assert.ok(!route.potentialInlineMutations.some(candidate => candidate.file === spec.file),
      "modalized authoring form should no longer be classified as inline: " + spec.file);
  }
  assert.equal(route.browserReviewStatus, "NOT_EXECUTED");
});
