/**
 * Family Lab UI browser evidence collection — synthetic NON-PRODUCTION only.
 *
 * --validate checks source coverage and safety contract without a browser.
 * --run deliberately requires staging URL, synthetic fixture declaration and
 * context states. No mutation buttons are clicked; this is screenshot/smoke
 * evidence, NOT clinical verification or final role/branch approval.
 *
 * Browser use: install 'playwright' and its chromium browser separately.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(ROOT, "docs", "UI_ROUTE_MANIFEST.json");
const VIEWPORTS = Object.freeze({
  desktop: {width: 1440, height: 900},
  mobile: {width: 390, height: 844},
  tablet: {width: 820, height: 1180},
});
const SCENARIOS = Object.freeze([
  {name:"desktop-ar-light",locale:"ar",direction:"rtl",viewport:"desktop",scheme:"light"},
  {name:"desktop-en-dark",locale:"en",direction:"ltr",viewport:"desktop",scheme:"dark"},
  {name:"mobile-ar-dark",locale:"ar",direction:"rtl",viewport:"mobile",scheme:"dark"},
  {name:"mobile-en-light",locale:"en",direction:"ltr",viewport:"mobile",scheme:"light"},
  {name:"tablet-ar-light",locale:"ar",direction:"rtl",viewport:"tablet",scheme:"light"},
  {name:"tablet-en-dark",locale:"en",direction:"ltr",viewport:"tablet",scheme:"dark"},
]);

function readManifest() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  if (!Array.isArray(manifest.routes) || manifest.routes.length !== 81 ||
      manifest.expectedRouteCount !== 81) {
    throw Error("Expected exactly 81 canonical routes. Refresh scope manifest before browser testing.");
  }
  const keys = new Set();
  for (const row of manifest.routes) {
    if (typeof row.route !== "string" || !row.route.startsWith("/") ||
        typeof row.file !== "string" || !row.file.endsWith("/page.tsx") ||
        keys.has(row.route)) throw Error("Malformed or duplicate canonical UI route.");
    keys.add(row.route);
    if (!fs.existsSync(path.join(ROOT, row.file))) {
      throw Error("Manifest source page missing: " + row.file);
    }
  }
  return manifest;
}

function stagingOrigin(input) {
  if (!input) throw Error("FL_UI_AUDIT_STAGING_ORIGIN must identify synthetic non-production staging.");
  const url = new URL(input);
  const isLocalhost = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(isLocalhost && url.protocol === "http:")) {
    throw Error("Staging origin must be HTTPS (HTTP permitted only on loopback).");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw Error("Staging origin must not include credentials, paths, query parameters or fragments.");
  }
  if (/(^|[.-])(prod|production|live)([.-]|$)/i.test(url.hostname)) {
    throw Error("Production or live target is explicitly forbidden.");
  }
  if (!isLocalhost && !/(^|[.-])(stage|staging|qa|sandbox|test)([.-]|$)/i.test(url.hostname)) {
    throw Error("Staging hostname must explicitly indicate non-production (stage, qa, sandbox or test).");
  }
  return url.origin;
}

function loadFixtureConfig(manifest) {
  if (process.env.FL_UI_AUDIT_SYNTHETIC_ONLY !== "I_CONFIRM_SYNTHETIC_NONPRODUCTION_DATA") {
    throw Error("Explicit synthetic-only attestation is required.");
  }
  const raw = process.env.FL_UI_AUDIT_CONFIG_JSON;
  if (!raw) throw Error("FL_UI_AUDIT_CONFIG_JSON must describe synthetic routes and role sessions.");
  const config = JSON.parse(raw);
  if (config.syntheticDataConfirmed !== true ||
      !config.routePaths || typeof config.routePaths !== "object" ||
      !config.profiles || typeof config.profiles !== "object") {
    throw Error("Missing synthetic fixture declaration or browser session profiles.");
  }
  const needed = manifest.routes.filter(row => row.route.includes("["));
  for (const row of needed) {
    if (typeof config.routePaths[row.route] !== "string") {
      throw Error("Missing synthetic dynamic-route fixture (no production ID fallback): " + row.route);
    }
  }
  return config;
}

function resolveRoute(base, row, config) {
  const actual = row.route.includes("[") ? config.routePaths[row.route] : row.route;
  if (!actual || typeof actual !== "string" || !actual.startsWith("/") ||
      actual.startsWith("//") || actual.includes("?") || actual.includes("#") ||
      actual.includes("..") || actual.includes("[") || actual.includes("]")) {
    throw Error("Invalid synthetic route mapping: " + row.route);
  }
  const resolved = new URL(actual, base);
  if (resolved.origin !== base) throw Error("Off-origin fixture mapping is forbidden.");
  return resolved.toString();
}

function profileForRoute(route, locale, config) {
  const overrides = config.routeProfiles || {};
  const names = overrides[route] || (
    route === "/" || route === "/login" || route === "/setup" || route === "/portal/login" ||
    route.startsWith("/verify/") || route.startsWith("/queue-display/")
      ? {ar:"anonymous",en:"anonymous"}
      : route.startsWith("/portal")
        ? {ar:"portal_ar",en:"portal_en"}
        : {ar:"staff_ar",en:"staff_en"}
  );
  if (!names || typeof names[locale] !== "string") {
    throw Error("Missing explicit " + locale + " review profile for canonical route: " + route);
  }
  const profile = names[locale];
  if (profile !== "anonymous" && !config.profiles[profile]) {
    throw Error("Profile is not configured for synthetic staging route: " + route);
  }
  return profile;
}

function photoFile(folder, route, scenario) {
  const digest = createHash("sha256").update(route).digest("hex").slice(0,12);
  const readable = route.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0,62) || "root";
  return path.join(folder, readable + "-" + digest + "-" + scenario + ".png");
}

function coverageCases(manifest, base, config) {
  const cases = [];
  for (const row of manifest.routes) {
    const target = resolveRoute(base, row, config);
    for (const scenario of SCENARIOS) {
      const profile = profileForRoute(row.route, scenario.locale, config);
      cases.push({route:row.route, target, profile, scenario});
    }
  }
  if (cases.length !== 486 ||
    new Set(cases.map(item => item.route)).size !== 81) {
    throw Error("Every route must have the six desktop/mobile/tablet and AR/EN scenarios.");
  }
  return cases;
}

async function screenshotAll() {
  const manifest = readManifest();
  const base = stagingOrigin(process.env.FL_UI_AUDIT_STAGING_ORIGIN);
  const config = loadFixtureConfig(manifest);
  const cases = coverageCases(manifest, base, config);

  // Playwright is intentionally optional for the default CI source gate.
  const {chromium} = await import("playwright");
  const out = path.resolve(process.env.FL_UI_AUDIT_OUTPUT_DIR || "ui-browser-evidence");
  fs.mkdirSync(out, {recursive:true});
  const images = path.join(out, "screenshots");
  fs.mkdirSync(images, {recursive:true});
  const browser = await chromium.launch({headless:true});
  const findings = [];
  try {
    for (const item of cases) {
      const {route,target,profile,scenario} = item;
      const name = scenario.name;
      const issues = [];
      const options = {
        viewport: VIEWPORTS[scenario.viewport],
        locale: scenario.locale === "ar" ? "ar-AE" : "en-GB",
        colorScheme: scenario.scheme,
        reducedMotion:"reduce",
      };
      if (profile !== "anonymous") {
        // These states exist only in a GitHub Actions secret or local private
        // fixture, never in source control, logs or committed screenshots.
        options.storageState = config.profiles[profile];
      }
      const context = await browser.newContext(options);
      const page = await context.newPage();
      let pageErrorCount = 0;
      page.on("pageerror", () => { pageErrorCount++; });
      let responseStatus = null;
      let finalRoute = "";
      let imageName = null;
      let documentLang = "";
      let documentDirection = "";
      let horizontalOverflow = false;
      try {
        const response = await page.goto(target, {waitUntil:"domcontentloaded",timeout:30000});
        responseStatus = response?.status() ?? null;
        await page.waitForLoadState("load", {timeout:12000}).catch(() => {});
        await page.waitForTimeout(180);
        finalRoute = new URL(page.url()).pathname;
        const info = await page.evaluate(() => ({
          lang: document.documentElement.lang,
          direction: document.documentElement.dir || getComputedStyle(document.body).direction,
          overflow: document.documentElement.scrollWidth > window.innerWidth + 12,
          body: Boolean(document.querySelector("body")?.textContent?.trim()),
        }));
        documentLang = info.lang;
        documentDirection = info.direction;
        horizontalOverflow = info.overflow;
        if (responseStatus === null || responseStatus >= 400) issues.push("HTTP_NON_SUCCESS");
        if (!info.body) issues.push("EMPTY_DOCUMENT");
        if (info.overflow) issues.push("HORIZONTAL_VIEWPORT_OVERFLOW");
        if (documentLang.toLowerCase().split("-")[0] !== scenario.locale) {
          issues.push("HTML_LANGUAGE_MISMATCH");
        }
        if (documentDirection !== scenario.direction) {
          issues.push("HTML_DIRECTION_MISMATCH");
        }
        if (finalRoute !== new URL(target).pathname &&
            finalRoute.startsWith("/login") && !route.includes("login")) {
          issues.push("REDIRECTED_TO_LOGIN");
        }
        if (pageErrorCount) issues.push("RUNTIME_ERRORS");
        imageName = path.basename(photoFile(images, route, name));
        await page.screenshot({
          path:path.join(images,imageName),fullPage:true,animations:"disabled",timeout:30000,
        });
      } catch {
        // Deliberately do not record exception/response text: a staging
        // application could accidentally embed patient names in exceptions.
        issues.push("NAVIGATION_OR_SCREENSHOT_FAILED");
      } finally {
        await context.close();
      }
      findings.push({
        canonicalRoute:route,scenario:name,profile,
        responseStatus,redirectedToLogin:issues.includes("REDIRECTED_TO_LOGIN"),
        htmlLanguage:documentLang,htmlDirection:documentDirection,
        horizontalOverflow,uncaughtRuntimeErrorCount:pageErrorCount,
        evidenceImage:imageName,
        status:issues.length ? "REVIEW_REQUIRED" : "SCREENSHOT_CAPTURED",
        issues,
        // Screenshots are *not* visually reviewed by this automated process.
        visualHumanSignoff:"NOT_EXECUTED",
        modalInteractionSignoff:"NOT_EXECUTED",
        clinicalSafetySignoff:"NOT_EXECUTED",
        themePaletteSignoff:"NOT_EXECUTED",
        timezoneDateFormatSignoff:"NOT_EXECUTED",
        branchRoleSignoff:"NOT_EXECUTED",
      });
    }
  } finally {
    await browser.close();
  }
  const errors = findings.filter(item => item.status !== "SCREENSHOT_CAPTURED");
  const evidence = {
    schemaVersion:1,
    state:"AUTOMATED_SCREENSHOT_EVIDENCE_ONLY_NOT_FINAL_UAT",
    canonicalRouteCount:81,
    scenarioCount:cases.length,
    executedCaseCount:findings.length,
    captures:findings.filter(x=>Boolean(x.evidenceImage)).length,
    casesRequiringReview:errors.length,
    humanVisualSignoff:"NOT_EXECUTED",
    ownerAcceptance:"NOT_EXECUTED",
    qualifiedClinicalGo:"NO_GO",
    // No staging hostname, session cookies, names, credentials or real fixture
    // values are persisted to the review evidence file.
    findings,
  };
  fs.writeFileSync(path.join(out,"ui-browser-evidence.json"),JSON.stringify(evidence,null,2)+"\n");
  console.log("Synthetic staging browser evidence: " + evidence.executedCaseCount +
    " / " + evidence.scenarioCount + " scenarios; " + evidence.captures +
    " screenshots; " + errors.length + " require review. Human signoff NOT_EXECUTED.");
  if (errors.length || evidence.executedCaseCount!==486 || evidence.captures!==486) {
    process.exitCode=1;
  }
}

try {
  readManifest();
  if (process.argv.includes("--validate")) {
    console.log("UI browser harness source gate: 81 canonical routes; six bilingual/responsive scenarios each. Browser evidence NOT_EXECUTED.");
  } else if (process.argv.includes("--run")) {
    await screenshotAll();
  } else {
    throw Error("Use --validate for static coverage or --run for approved synthetic staging browser evidence.");
  }
} catch (error) {
  // Do not accidentally print raw fixture secrets or page contents.
  console.error(error instanceof Error ? error.message : "UI browser evidence gate failed.");
  process.exitCode=1;
}
