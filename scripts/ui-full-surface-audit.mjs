import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_ROOT = path.join(ROOT, "src", "app");
const COMPONENTS_ROOT = path.join(ROOT, "src", "components");
const MANIFEST_FILE = path.join(ROOT, "docs", "UI_ROUTE_MANIFEST.json");

const rel = file => path.relative(ROOT, file).split(path.sep).join("/");
const lineOf = (tree, node) => tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
const pathExists = candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile();

function resolveUiImport(from, specifier) {
  let base = null;
  if (specifier.startsWith("@/components/")) {
    base = path.join(COMPONENTS_ROOT, specifier.slice("@/components/".length));
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    base = path.resolve(path.dirname(from), specifier);
  } else if (specifier.startsWith("@/app/")) {
    base = path.join(APP_ROOT, specifier.slice("@/app/".length));
  }
  if (!base) return null;
  return [base + ".tsx", path.join(base, "index.tsx"), base]
    .find(file => file.endsWith(".tsx") && pathExists(file)) || null;
}

function jsxTag(node, tree) {
  return node.tagName.getText(tree);
}

function jsxAttribute(node, attribute, tree) {
  const a = node.attributes?.properties?.find(prop =>
    ts.isJsxAttribute(prop) && prop.name.getText(tree) === attribute);
  if (!a) return null;
  if (a.initializer && ts.isStringLiteral(a.initializer)) return a.initializer.text;
  if (a.initializer && ts.isJsxExpression(a.initializer)) return a.initializer.expression?.getText(tree) || "";
  return "";
}

function modalAncestor(node, tree) {
  let parent = node.parent;
  while (parent) {
    if (ts.isJsxElement(parent) && jsxTag(parent.openingElement, tree) === "CrudModal") return true;
    parent = parent.parent;
  }
  return false;
}

const sourceCache = new Map();

function inspect(file) {
  const pathname = rel(file);
  const cached = sourceCache.get(pathname);
  if (cached) return cached;
  const source = fs.readFileSync(file, "utf8");
  const tree = ts.createSourceFile(pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = [];
  const forms = [];
  const modals = [];
  const nativeDialogs = [];
  const dateTimeCallsites = [];
  const actions = [];
  const jsxTags = new Map();

  for (const statement of tree.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const resolved = resolveUiImport(file, statement.moduleSpecifier.text);
      if (resolved) imports.push(resolved);
    }
  }
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = jsxTag(node, tree);
      jsxTags.set(tag, (jsxTags.get(tag) || 0) + 1);
      if (tag === "form") {
        const method = jsxAttribute(node, "method", tree);
        const handler = jsxAttribute(node, "onSubmit", tree);
        const action = jsxAttribute(node, "action", tree);
        const insideModal = modalAncestor(node, tree);
        const clearlyGet = method?.toUpperCase() === "GET";
        forms.push({
          file: pathname,
          line: lineOf(tree, node),
          insideModal,
          method: method || null,
          handler: handler || null,
          action: action || null,
          classification: clearlyGet ? "NAVIGATION_FILTER" :
            insideModal ? "MODAL_FORM" : "REVIEW_INLINE_FORM",
        });
      }
      if (tag === "CrudModal") {
        const size = jsxAttribute(node, "size", tree);
        modals.push({
          file: pathname,
          line: lineOf(tree, node),
          size: size ?? "md(default)",
          compact: size === "compact",
        });
      }
      if (tag === "button" && jsxAttribute(node, "onClick", tree) !== null) {
        actions.push({file: pathname, line: lineOf(tree, node), kind: "button-onClick"});
      }
    }
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(tree);
      const ln = lineOf(tree, node);
      if (["window.prompt", "prompt", "window.confirm", "confirm",
        "window.alert", "alert"].includes(expression)) {
        nativeDialogs.push({file: pathname, line: ln, method: expression});
      }
      if (/(?:toLocaleString|toLocaleDateString|toLocaleTimeString|toISOString|Intl\.DateTimeFormat)/.test(expression)) {
        dateTimeCallsites.push({
          file: pathname, line: ln, expression: expression.slice(0, 110),
          contextReview: "REQUIRED",
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  const info = {
    file: pathname,
    imports,
    forms,
    modals,
    actions,
    nativeDialogs,
    dateTimeCallsites,
    jsxTags: [...jsxTags],
  };
  sourceCache.set(pathname, info);
  return info;
}

function allPageFiles(directory) {
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "api" ? [] : allPageFiles(full);
    return entry.name === "page.tsx" ? [full] : [];
  });
}

function routeFromFile(file) {
  const relative = rel(file);
  const nodes = relative.slice("src/app/".length, -"/page.tsx".length)
    .split("/").filter(segment => segment && !/^\(.*\)$/.test(segment));
  return nodes.length ? "/" + nodes.join("/") : "/";
}

function buildGraph(root) {
  const queue = [root];
  const visited = new Set();
  const details = [];
  while (queue.length) {
    const file = queue.shift();
    const relative = rel(file);
    if (visited.has(relative)) continue;
    visited.add(relative);
    const report = inspect(file);
    details.push(report);
    for (const imported of report.imports) if (!visited.has(rel(imported))) queue.push(imported);
  }
  return details;
}

function detailedRoute(file) {
  const route = routeFromFile(file);
  const graph = buildGraph(file);
  const forms = graph.flatMap(node => node.forms);
  const modals = graph.flatMap(node => node.modals);
  const nativeDialogs = graph.flatMap(node => node.nativeDialogs);
  const dateTimeCallsites = graph.flatMap(node => node.dateTimeCallsites);
  const actions = graph.flatMap(node => node.actions);
  const dynamicParameters = [...route.matchAll(/\[([^\]]+)\]/g)].map(x => x[1]);
  const highRisk = /^\/(?:worklists|orders|microbiology|phlebotomy|critical-results|reports|billing|clinical-rules|specimens|patients)/.test(route);
  const workflows = {
    sourceReview: "DISCOVERED",
    actualBrowserReview: "NOT_EXECUTED",
    mobileTabletDesktop: "NOT_EXECUTED",
    arEnRtlLtr: "NOT_EXECUTED",
    organizationTheme: "NOT_EXECUTED",
    timezoneDateTime: "NOT_EXECUTED",
    keyboardScreenReader: "NOT_EXECUTED",
    branchRoleIsolation: "NOT_EXECUTED",
    screenshots: "NOT_CAPTURED",
    clinicalSafetyReview: highRisk ? "NOT_EXECUTED" : "NOT_APPLICABLE_OR_UNDETERMINED",
  };
  return {
    route,
    file: rel(file),
    pageType: route === "/" || /^\/(?:login|setup|portal\/login|verify\/|queue-display\/)/.test(route)
      ? "PUBLIC_OR_AUTH" : route.startsWith("/portal") ? "PORTAL" :
      dynamicParameters.length ? "DYNAMIC_ENTITY" : "AUTHENTICATED_OR_UNKNOWN",
    dynamicParameters,
    sourceFileCount: graph.length,
    importedUiFiles: graph.slice(1).map(item => item.file),
    forms,
    modals,
    nativeDialogs,
    dateTimeCallsites,
    actionButtonCount: actions.length,
    candidateInlineMutations: forms.filter(form => form.classification === "REVIEW_INLINE_FORM"),
    nonCompactModals: modals.filter(modal => !modal.compact),
    workflows,
  };
}

export function createFullUiAudit() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));
  const routeRows = allPageFiles(APP_ROOT).sort().map(detailedRoute);
  const sources = [...sourceCache.values()];
  const components = fs.readdirSync(COMPONENTS_ROOT).filter(name => name.endsWith(".tsx"))
    .map(name => rel(path.join(COMPONENTS_ROOT, name))).sort();
  const graphComponentSet = new Set(routeRows.flatMap(row => row.importedUiFiles));
  const unreferencedComponents = components.filter(item => !graphComponentSet.has(item));
  const violations = [];
  if (manifest.expectedRouteCount !== routeRows.length || routeRows.length !== 81) {
    violations.push("Route count mismatch from canonical baseline; update full-screen review manifest.");
  }
  const canonical = routeRows.map(row => row.file + "\t" + row.route).sort();
  const reference = manifest.routes.map(row => row.file + "\t" + row.route).sort();
  if (JSON.stringify(canonical) !== JSON.stringify(reference)) violations.push("Route path manifest mismatch.");
  if (new Set(routeRows.map(row => row.route)).size !== routeRows.length) violations.push("Duplicate route.");
  if (routeRows.some(row => row.workflows.actualBrowserReview !== "NOT_EXECUTED")) {
    violations.push("Source-only process cannot assert browser acceptance.");
  }
  return {
    schemaVersion: 1,
    baseRouteManifest: "docs/UI_ROUTE_MANIFEST.json",
    coverageStatement: "All 81 source pages and recursively reachable TSX UI components were inspected statically. Actual browser QA has NOT been performed.",
    routesInspected: routeRows.length,
    totalUiComponents: components.length,
    componentsFoundByRouteGraph: graphComponentSet.size,
    componentsUnreferencedByRouteGraph: unreferencedComponents,
    sourceFilesInspected: sources.length,
    uniquePotentialInlineForms: new Set(routeRows.flatMap(row => row.candidateInlineMutations.map(f => f.file + ":" + f.line))).size,
    uniqueNonCompactDialogs: new Set(routeRows.flatMap(row => row.nonCompactModals.map(m => m.file + ":" + m.line))).size,
    uniqueNativeDialogCalls: new Set(routeRows.flatMap(row => row.nativeDialogs.map(m => m.file + ":" + m.line))).size,
    uniqueDateTimeCallsites: new Set(routeRows.flatMap(row => row.dateTimeCallsites.map(m => m.file + ":" + m.line))).size,
    violations,
    routes: routeRows,
  };
}

function markdown(audit) {
  const lines = [
    "# Family Lab — exhaustive STATIC UI source audit (NOT browser acceptance)",
    "",
    "**Scope:** every canonical page, reachable nested TSX import, and independently listed",
    "component. Review includes protected/portal/public/print routes; no patient fixture",
    "or live clinical environment was used.",
    "",
    "Source pages: " + audit.routesInspected +
    "; components in repository: " + audit.totalUiComponents +
    "; recursively found components: " + audit.componentsFoundByRouteGraph +
    "; unreferenced components: " + audit.componentsUnreferencedByRouteGraph.length + ".",
    "",
    "Distinct possible inline forms: " + audit.uniquePotentialInlineForms +
    "; non-compact dialogs: " + audit.uniqueNonCompactDialogs +
    "; native alert/confirm/prompt calls: " + audit.uniqueNativeDialogCalls +
    "; date/time formatting callsites needing review: " + audit.uniqueDateTimeCallsites + ".",
    "",
    "**These figures are candidates, not proven visual defects or test completions.**",
    "",
    "| Route | UI files | Forms | Inline candidates | Noncompact | Native dialogs | Dates | Browser / mobile / RTL / branch / theme |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...audit.routes.map(row => [
      "|", row.route.replaceAll("|", "\\|"), "|", row.sourceFileCount, "|", row.forms.length,
      "|", row.candidateInlineMutations.length, "|", row.nonCompactModals.length,
      "|", row.nativeDialogs.length, "|", row.dateTimeCallsites.length,
      "| NOT_EXECUTED |",
    ].join(" ")),
    "",
    "## Specific files requiring triage (deduplicated)",
    "",
    ...[
      ["Inline form candidates", "candidateInlineMutations"],
      ["Existing noncompact modal sizes", "nonCompactModals"],
      ["Native dialogs", "nativeDialogs"],
      ["Date/time locale and timezone review", "dateTimeCallsites"],
    ].flatMap(([heading, field]) => {
      const entries = [...new Map(audit.routes.flatMap(row => row[field].map(item =>
        [item.file + ":" + item.line,
          "- \`" + item.file + ":" + item.line + "\` " +
          (item.size || item.method || item.expression || item.handler || "") +
          " — route(s) needing review"]))).values()];
      return ["### " + heading, "", ...entries, ""];
    }),
    "## Components without a reachable page import",
    "",
    ...audit.componentsUnreferencedByRouteGraph.map(file => "- \`" + file + "\` (separate review required)"),
    "",
    "## Every route still needs real UI evidence",
    "",
    "Authenticated test fixtures, permitted branch/role accounts and a safe isolated",
    "base URL are required for all user-facing interactive/screenshot review.",
    "Browser QA must include modal create/edit/retry/dirty close/reopen/keyboard/role",
    "authorization; AR/EN and RTL/LTR; theme changes; organization timezone and",
    "date/time format; desktop/tablet/mobile; print and relevant clinical workflow checks.",
    "",
    "Stage132 88/88 real UAT and clinical/finance/device/DR signoff remain separate.",
    "No static audit status may be converted into clinical GO.",
    "",
  ];
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const audit = createFullUiAudit();
    if (audit.violations.length) throw Error(audit.violations.join("\n"));
    if (process.argv.includes("--json")) process.stdout.write(JSON.stringify(audit, null, 2) + "\n");
    else if (process.argv.includes("--markdown")) process.stdout.write(markdown(audit));
    else console.log("Full STATIC UI coverage: " + audit.routesInspected +
      " page routes, " + audit.totalUiComponents + " UI component source files; " +
      audit.uniquePotentialInlineForms + " possible inline forms. Real browser signoff NOT_EXECUTED.");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
