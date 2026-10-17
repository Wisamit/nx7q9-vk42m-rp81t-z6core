#!/usr/bin/env node
/**
 * Conservative UI form inventory: this is a source scanner, NOT browser UAT.
 * JSX conditionals, components and nested dialogs require manual classification.
 * Do not interpret counts alone as proof of UI release readiness.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const manifest = JSON.parse(readFileSync("docs/UI_ROUTE_MANIFEST.json", "utf8"));
const routes = manifest.routes.map(entry => entry.file);
if (routes.length !== 81 || new Set(routes).size !== 81) {
  throw new Error("UI inventory must contain 81 unique canonical routes");
}
const componentDir = "src/components";
const componentFiles = readdirSync(componentDir).filter(name => name.endsWith(".tsx"))
  .map(name => join(componentDir, name));
const parse = path => {
  const content = readFileSync(path, "utf8");
  const forms = [...content.matchAll(/<form\b/g)].length;
  const dialogs = [...content.matchAll(/<CrudModal\b/g)].length;
  const getFilters = [...content.matchAll(/<form\b[^>]*\bmethod=["']get["']/gi)].length;
  return { path, forms, dialogs, getFilters };
};
const routeInventory = routes.map(parse);
const componentInventory = componentFiles.map(parse);
const openExceptionReview = {
  "src/components/bulk-result-entry.tsx": "Time-critical bulk result entry: medical safety and owner decision required before modalization",
  "src/components/phlebotomy-collection-card.tsx": "Time-critical active specimen collection: owner/clinical decision required before modalization",
  "src/components/portal-contact-verification.tsx": "Portal identity challenge: privacy and accessibility review required before modalization",
  "src/components/clinical-catalog-manager.tsx": "One shared state-driven CrudModal contains several mutually exclusive clinical forms; inspect exact JSX",
  "src/components/microbiology-case-editor.tsx": "Specialty case editing includes conditional forms; inspect context, clinical safety and modal containment",
  "src/components/security-settings.tsx": "Security MFA/recovery is multi-state; inspect all forms and focus states, do not infer failure from counts",
};
const possibleInline = componentInventory
  .filter(row => row.forms > row.dialogs)
  .map(row => ({ ...row, review: openExceptionReview[row.path] || "Manual interactive/clinical review required" }));
const mustBeDialog = [
  "src/components/patient-edit-form.tsx",
  "src/components/staff-report-handover.tsx",
  "src/components/result-repeat-panel.tsx",
  "src/components/role-management.tsx",
];
for (const path of mustBeDialog) {
  const component = componentInventory.find(item => item.path === path);
  if (!component || !component.dialogs) throw new Error(`Missing governed action dialog: ${path}`);
}
const result = {
  purpose: "Source inventory, not browser acceptance",
  routeCount: routes.length,
  componentCount: componentInventory.length,
  routeInventory,
  componentInventory,
  possibleInline,
};
const output = JSON.stringify(result, null, 2);
if (process.argv.includes("--summary")) {
  console.log(JSON.stringify({
    routeCount: result.routeCount, componentCount: result.componentCount,
    routeGetFilters: routeInventory.filter(row => row.getFilters).map(row => row.path),
    possibleInline,
  }, null, 2));
} else {
  console.log(output);
}
