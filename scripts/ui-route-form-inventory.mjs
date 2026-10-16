import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = path.join(ROOT, "src", "app");
const MANIFEST = path.join(ROOT, "docs", "UI_ROUTE_MANIFEST.json");

/**
 * Static discovery only. A form imported through a deeper component tree or
 * a dynamic renderer may not appear in direct imports. This inventory must
 * never be treated as evidence that a screen was visually reviewed.
 */
function walkPages(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "api" ? [] : walkPages(full);
    return entry.name === "page.tsx" ? [path.relative(ROOT, full).split(path.sep).join("/")] : [];
  });
}

function routeFromPage(file) {
  const fragments = file.slice("src/app/".length, -"/page.tsx".length)
    .split("/").filter(part => part && !/^\(.+\)$/.test(part));
  return fragments.length ? "/" + fragments.join("/") : "/";
}

function domainForRoute(route) {
  if (route.startsWith("/portal")) return "patient-portal";
  if (route.startsWith("/verify/") || route.startsWith("/queue-display/")) return "public-verification";
  if (route === "/login" || route === "/setup" || route === "/") return "public-auth-entry";
  if (route.startsWith("/billing") || route === "/pricing") return "billing";
  if (route.startsWith("/patients")) return "patients";
  if (route.startsWith("/orders") || route.startsWith("/specimens") ||
      route.startsWith("/worklists") || route.startsWith("/phlebotomy") ||
      route.startsWith("/transfers") || route.startsWith("/home-collections")) return "lab-operations";
  if (route.startsWith("/reports") || route.startsWith("/report-templates")) return "reports";
  if (route.startsWith("/catalog") || route.startsWith("/clinical-rules") ||
      route.startsWith("/clinical-comments")) return "catalog-clinical";
  if (route.startsWith("/inventory") || route.startsWith("/equipment") ||
      route.startsWith("/qc") || route.startsWith("/quality")) return "quality-inventory";
  return "administration-other";
}

function resolveComponent(specifier) {
  if (!specifier.startsWith("@/components/")) return null;
  const base = path.join(ROOT, "src", "components", specifier.slice("@/components/".length));
  const match = [base + ".tsx", base + ".ts", path.join(base, "index.tsx")]
    .find(candidate => fs.existsSync(candidate));
  return match ? path.relative(ROOT, match).split(path.sep).join("/") : null;
}

const sourceCache = new Map();

function inspectFile(file) {
  if (sourceCache.has(file)) return sourceCache.get(file);
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  const document = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = [];
  const forms = [];
  let modalCount = 0;
  let clickableActionCount = 0;
  for (const statement of document.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const component = resolveComponent(statement.moduleSpecifier.text);
      if (component) imports.push(component);
    }
  }

  function insideModal(node) {
    let ancestor = node.parent;
    while (ancestor) {
      if (ts.isJsxElement(ancestor) &&
          ancestor.openingElement.tagName.getText(document) === "CrudModal") return true;
      ancestor = ancestor.parent;
    }
    return false;
  }

  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(document);
      if (tag === "CrudModal") modalCount++;
      if (tag === "button" && node.attributes.properties.some(property =>
        ts.isJsxAttribute(property) && property.name.getText(document) === "onClick")) {
        clickableActionCount++;
      }
      if (tag === "form") {
        const methodAttribute = node.attributes.properties.find(property =>
          ts.isJsxAttribute(property) && property.name.getText(document) === "method");
        const method = methodAttribute && ts.isJsxAttribute(methodAttribute) &&
          methodAttribute.initializer && ts.isStringLiteral(methodAttribute.initializer)
          ? methodAttribute.initializer.text.toUpperCase() : null;
        const formMode = method === "GET" ? "navigation-or-filter" : "mutation-or-review";
        forms.push({
          line: document.getLineAndCharacterOfPosition(node.getStart(document)).line + 1,
          mode: formMode,
          insideCrudModal: insideModal(node),
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(document);
  const info = {
    file,
    importedComponents: [...new Set(imports)].sort(),
    formCount: forms.length,
    forms,
    modalCount,
    clickableActionCount,
  };
  sourceCache.set(file, info);
  return info;
}

export function createUiRouteInventory() {
  const files = walkPages(APP).sort();
  const routes = files.map(file => {
    const page = inspectFile(file);
    const components = page.importedComponents.map(inspectFile);
    const potentialInlineMutations = [page, ...components].flatMap(item =>
      item.forms.filter(form => form.mode === "mutation-or-review" && !form.insideCrudModal)
        .map(form => ({ file: item.file, line: form.line })));
    return {
      file,
      route: routeFromPage(file),
      domain: domainForRoute(routeFromPage(file)),
      directPageForms: page.formCount,
      directPageModals: page.modalCount,
      directComponentCount: components.length,
      componentForms: components.reduce((sum, component) => sum + component.formCount, 0),
      componentModals: components.reduce((sum, component) => sum + component.modalCount, 0),
      potentialInlineMutations,
      importedComponents: components.map(item => item.file),
      browserReviewStatus: "NOT_EXECUTED",
      mobileReviewStatus: "NOT_EXECUTED",
      arEnReviewStatus: "NOT_EXECUTED",
      roleBranchReviewStatus: "NOT_EXECUTED",
    };
  });
  return {
    schemaVersion: 1,
    notice: "Static discovery of direct component imports only; this is not browser or UAT evidence.",
    routeCount: routes.length,
    scannedDirectComponentCount: new Set(routes.flatMap(route => route.importedComponents)).size,
    possibleInlineMutationCount: routes.reduce((sum, route) =>
      sum + route.potentialInlineMutations.length, 0),
    routes,
  };
}

export function assertManifestMatchesInventory(inventory) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.expectedRouteCount !== inventory.routeCount) {
    throw Error("UI route manifest count/schema drift; update the signed review manifest.");
  }
  const canonical = inventory.routes.map(route => ({ file: route.file, route: route.route }));
  const sortedManifest = [...manifest.routes].sort((a, b) => a.file.localeCompare(b.file));
  const sortedCanonical = [...canonical].sort((a, b) => a.file.localeCompare(b.file));
  if (JSON.stringify(sortedManifest) !== JSON.stringify(sortedCanonical)) {
    throw Error("UI route manifest drift: a page was added, removed or renamed without review inventory update.");
  }
  if (new Set(inventory.routes.map(route => route.route)).size !== inventory.routeCount) {
    throw Error("Duplicate route path in UI source inventory.");
  }
  if (inventory.routes.some(route => route.browserReviewStatus !== "NOT_EXECUTED")) {
    throw Error("Static source inventory cannot claim qualified browser acceptance.");
  }
}

function escapeTable(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function markdown(inventory) {
  const lines = [
    "# Family Lab: Full route/form review inventory — static discovery",
    "",
    "> Auto-generated from source; NOT a browser audit, signed clinical acceptance or release GO.",
    "> Includes first-level imported components only; nested/dynamic forms need manual discovery.",
    "",
    "Routes: " + inventory.routeCount + ". Direct component files: " +
      inventory.scannedDirectComponentCount + ". Potential inline mutation forms: " +
      inventory.possibleInlineMutationCount + ".",
    "",
    "| Route | Domain | Page | Imported components | Page forms/modals | Direct-component forms/modals | Potential inline forms | Browser / AR-EN / Mobile / Roles |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | --- |",
    ...inventory.routes.map(row =>
      "| " + escapeTable(row.route) + " | " + row.domain + " | `" + row.file +
      "` | " + row.directComponentCount + " | " + row.directPageForms + "/" +
      row.directPageModals + " | " + row.componentForms + "/" + row.componentModals +
      " | " + row.potentialInlineMutations.length + " | NOT_EXECUTED |"),
    "",
    "## Potential inline forms (triage candidates, NOT confirmed issues)",
    "",
    ...inventory.routes.flatMap(row => row.potentialInlineMutations.map(item =>
      "- `" + row.route + "`: `" + item.file + ":" + item.line +
      "` — verify mutation vs navigation/clinical full-screen exception")),
    "",
    "## Review evidence still required",
    "",
    "Per route and permission/branch: actual screenshots and interactive keyboard/focus/dirty-close",
    "testing, AR/EN RTL/LTR, viewport/zoom, theme/timezone/date formats, validation and",
    "workflow behavior. Add owner-approved exceptions for high-risk clinical interfaces;",
    "this discovery does not exempt or complete them.",
    "",
  ];
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const inventory = createUiRouteInventory();
    assertManifestMatchesInventory(inventory);
    if (process.argv.includes("--json")) process.stdout.write(JSON.stringify(inventory, null, 2) + "\n");
    else if (process.argv.includes("--markdown")) process.stdout.write(markdown(inventory));
    else console.log("UI inventory verified: " + inventory.routeCount + " routes; " +
      inventory.possibleInlineMutationCount +
      " possible first-level inline forms. Browser acceptance remains NOT_EXECUTED.");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
