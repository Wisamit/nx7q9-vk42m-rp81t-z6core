import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const GLOBAL_CSS = path.join(ROOT, "src", "app", "globals.css");

function fail(message) {
  console.error("\nUI theme guard failed:\n" + message);
  process.exitCode = 1;
}

function stripRootPalette(css) {
  const start = css.indexOf(":root{");
  if (start < 0) return css;
  const end = css.indexOf("}", start);
  if (end < 0) return css;
  return css.slice(0, start) + css.slice(end + 1);
}

const css = fs.readFileSync(GLOBAL_CSS, "utf8");
const screenCss = stripRootPalette(css);
const rawCssColors = [
  ...(screenCss.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []),
  ...(screenCss.match(/rgba?\([^)]*\)/g) ?? []),
];

if (rawCssColors.length) {
  fail("globals.css contains raw screen colors outside the root default palette: " +
    [...new Set(rawCssColors)].join(", ") +
    ". Use semantic --fl-* theme variables or color-mix().");
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return [full];
  });
}

const sourceFiles = walk(path.join(ROOT, "src"))
  .filter(file => /\.(tsx|jsx|css)$/.test(file))
  .filter(file => file !== GLOBAL_CSS);

const inlineViolations = [];
for (const file of sourceFiles) {
  const source = fs.readFileSync(file, "utf8");
  const matches = source.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) ?? [];
  if (matches.length) {
    inlineViolations.push(
      path.relative(ROOT, file) + ": " + [...new Set(matches)].join(", ")
    );
  }
}

if (inlineViolations.length) {
  fail("UI source files contain hard-coded colors:\n" + inlineViolations.join("\n"));
}

if (!process.exitCode) {
  console.log("UI theme guard passed: screen UI uses semantic theme colors.");
}
