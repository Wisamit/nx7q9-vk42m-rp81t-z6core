import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const UI_ROOTS = [path.join(ROOT, "src", "app"), path.join(ROOT, "src", "components")];
const GLOBAL_CSS = path.join(ROOT, "src", "app", "globals.css");

const TECHNICAL_TEXT = new Set([
  "FL",
  "Family Lab LIS",
  "Family Lab",
  "TAT",
  "LOINC",
  "URL",
  "HTTP",
  "S/I/R",
  "MIC",
  "SD",
  "CV",
  "QC",
  "CAPA",
  "SOP",
  "FHIR_R4",
  "HL7_V2",
  "REST",
  "WEBHOOK",
  "ASTM",
  "HL7 v2",
  "FILE",
  "CSV",
  "SERIAL",
  "TCP_CLIENT",
  "TCP_SERVER",
  "WATCH_FOLDER",
  "API_KEY",
  "BEARER",
  "BASIC",
  "HMAC",
  "SNOMED_CT",
  "ICD10",
  "LOCAL",
  "AED",
  "EGP",
  "USD",
  "EUR",
  "UTC",
  "mL",
  "DD/MM/YYYY",
  "MM/DD/YYYY",
  "YYYY-MM-DD",
  "DD MMM YYYY",
  "S",
  "I",
  "R",
]);

const TECHNICAL_ATTRIBUTE_PATTERNS = [
  /^(?:https?:\/\/|env:)/i,
  /^[A-Z][A-Z0-9_./:# -]{1,80}$/,
  /^\d{1,4}(?:\/\d{1,4})+(?:\/\d{1,4})?$/,
  /^(?:DD|MM|YYYY|MMM)[A-Z /-]*$/,
  /^[A-Z]{2,8}-[A-Z0-9_-]{2,}$/,
  /^v?\d+(?:\.\d+)+$/,
];

const CHECKED_ATTRIBUTES = new Set(["placeholder", "title", "aria-label"]);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full.includes(path.join("src", "app", "api"))) return [];
      return walk(full);
    }
    return [full];
  });
}

function normalize(value) {
  return value.replace(/\s+/g, " ").trim();
}

function containsArabic(value) {
  return /[\u0600-\u06FF]/.test(value);
}

function hasEnglish(value) {
  return /[A-Za-z]{2,}/.test(value);
}

function isTechnical(value, context) {
  const text = normalize(value);
  if (!text || !hasEnglish(text) || containsArabic(text)) return true;
  if (TECHNICAL_TEXT.has(text)) return true;
  if (context === "attribute" && TECHNICAL_ATTRIBUTE_PATTERNS.some(pattern => pattern.test(text))) return true;
  return false;
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

const violations = [];

function report(file, sourceFile, node, kind, value) {
  const text = normalize(value);
  if (isTechnical(text, kind === "attribute" ? "attribute" : "text")) return;
  violations.push({
    file: path.relative(ROOT, file),
    line: lineOf(sourceFile, node),
    kind,
    text,
  });
}

const files = UI_ROOTS.flatMap(walk).filter(file => /\.(tsx|jsx)$/.test(file));

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.JSX,
  );

  function visit(node) {
    if (ts.isJsxText(node)) {
      report(file, sourceFile, node, "jsx-text", node.getText(sourceFile));
    }

    if (ts.isJsxAttribute(node) && CHECKED_ATTRIBUTES.has(node.name.getText(sourceFile))) {
      const initializer = node.initializer;
      if (initializer && ts.isStringLiteral(initializer)) {
        report(file, sourceFile, node, "attribute", initializer.text);
      }
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      if (["confirm", "prompt", "setMessage"].includes(name)) {
        const first = node.arguments[0];
        if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) {
          report(file, sourceFile, first, "message", first.text);
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

const css = fs.readFileSync(GLOBAL_CSS, "utf8");
const physicalDirectionPatterns = [
  /text-align\s*:\s*(?:left|right)\b/g,
  /padding-(?:left|right)\s*:/g,
  /margin-(?:left|right)\s*:/g,
  /float\s*:\s*(?:left|right)\b/g,
];
for (const pattern of physicalDirectionPatterns) {
  let match;
  while ((match = pattern.exec(css))) {
    violations.push({
      file: path.relative(ROOT, GLOBAL_CSS),
      line: css.slice(0, match.index).split("\n").length,
      kind: "rtl-css",
      text: match[0],
    });
  }
}

if (violations.length) {
  console.error("\nUI i18n/RTL guard failed:");
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} [${violation.kind}] ${violation.text}`);
  }
  console.error("\nWrap user-facing text in locale-aware rendering (for example tr(...)) or add only genuinely technical terminology to the narrow allowlist.");
  process.exitCode = 1;
} else {
  console.log(`UI i18n/RTL guard passed: ${files.length} UI files checked.`);
}
