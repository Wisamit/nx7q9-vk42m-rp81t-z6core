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

function matchingFixturePath(route, actual) {
  const canonical = route.split("/").filter(Boolean);
  const supplied = actual.split("/").filter(Boolean);
  return canonical.length === supplied.length && canonical.every((part, index) =>
    /^\[[^/]+\]$/.test(part)
      ? Boolean(supplied[index] && !supplied[index].includes("[") && !supplied[index].includes("]"))
      : part === supplied[index]
  );
}

function assertSyntheticStorageStates(config, base) {
  const expectedHost = new URL(base).hostname;
  for (const [profile, storage] of Object.entries(config.profiles)) {
    if (!storage || typeof storage !== "object" || Array.isArray(storage) ||
        !Array.isArray(storage.cookies) || !Array.isArray(storage.origins)) {
      throw Error("Synthetic browser profile requires inline storageState object: " + profile);
    }
    for (const cookie of storage.cookies) {
      if (!cookie || cookie.domain?.replace(/^\./, "") !== expectedHost) {
        throw Error("Browser profile cookie domain must match staging host: " + profile);
      }
    }
    for (const origin of storage.origins) {
      if (!origin || origin.origin !== base) {
        throw Error("Browser profile localStorage origin must match staging origin: " + profile);
      }
    }
  }
}

function loadFixtureConfig(manifest, base) {
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
  assertSyntheticStorageStates(config, base);
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
  if (!matchingFixturePath(row.route, resolved.pathname)) {
    throw Error("Synthetic dynamic-route fixture does not match canonical route: " + row.route);
  }
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
  const config = loadFixtureConfig(manifest, base);
  const cases = coverageCases(manifest, base, config);

  // Playwright is intentionally optional for the default CI source gate.
  const {chromium} = await import("playwright");
  const out = path.resolve(process.env.FL_UI_AUDIT_OUTPUT_DIR || "ui-browser-evidence");
  fs.mkdirSync(out, {recursive:true});
  const images = path.join(out, "screenshots");
  fs.mkdirSync(images, {recursive:true});
  // Reusing an old folder could misrepresent previous artifacts as a new
  // sweep, even if a subsequent navigation fails. Require fresh private output.
  if (fs.readdirSync(images).length) {
    throw Error("Synthetic screenshot output directory must be empty before a new capture sweep.");
  }
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
      // Force only the app's cosmetic theme preference in isolated synthetic
      // sessions so a saved profile setting cannot mislabel a dark/light shot.
      await context.addInitScript(mode => {
        try { window.localStorage.setItem("family-lab-theme", mode); } catch {}
      }, scenario.scheme);
      const page = await context.newPage();
      let pageErrorCount = 0;
      page.on("pageerror", () => { pageErrorCount++; });
      let responseStatus = null;
      let finalRoute = "";
      let navigationTargetMatched = false;
      let documentFullyLoaded = false;
      let documentBodyHasContent = false;
      let visibleBusySurfaceCount = 0;
      let imageName = null;
      let evidenceSha256 = null;
      let documentLang = "";
      let documentDirection = "";
      let documentTheme = "";
      let horizontalOverflow = false;
      let renderedFormCount = 0;
      let renderedActionCount = 0;
      let visibleDialogCount = 0;
      let unlabeledInputCount = 0;
      let unlabeledActionCount = 0;
      let interactiveViewportClippingCount = 0;
      let dialogA11yIssueCount = 0;
      try {
        const response = await page.goto(target, {waitUntil:"domcontentloaded",timeout:30000});
        responseStatus = response?.status() ?? null;
        // Never silently turn a timed-out resource/document load into a
        // successful screenshot. Wait for fonts so RTL/LTR geometry is real.
        await page.waitForLoadState("load", {timeout:12000});
        await page.waitForFunction(() => document.fonts.status === "loaded", null, {timeout:12000});
        // Busy indicators may belong to streamed React pages. Allow them to
        // settle; if they persist, the observation below records review needed.
        await page.waitForFunction(() => {
          const visible = (el) => {
            const style = getComputedStyle(el);
            return style.display !== "none" && style.visibility !== "hidden" &&
              el.getClientRects().length > 0;
          };
          return ![...document.querySelectorAll(
            '[aria-busy="true"],[role="progressbar"],[data-loading="true"]'
          )].some(visible);
        }, null, {timeout:8000}).catch(() => {});
        await page.waitForTimeout(180);
        const finalUrl = new URL(page.url());
        finalRoute = finalUrl.pathname;
        navigationTargetMatched = finalRoute === new URL(target).pathname;
        if (finalUrl.origin !== base) {
          issues.push("REDIRECTED_OFF_STAGING_ORIGIN");
          throw Error("Browser redirected off isolated staging origin.");
        }
        // Read-only rendered-surface inspection: counts only, never captures
        // form values, patient names, identifiers, labels or DOM text in JSON.
        const info = await page.evaluate(() => {
          const visible = (el) => {
            const style = getComputedStyle(el);
            return style.display !== "none" && style.visibility !== "hidden" &&
              el.getClientRects().length > 0;
          };
          const controls = [...document.querySelectorAll(
            "input:not([type=hidden]), select, textarea"
          )].filter(visible);
          const actions = [...document.querySelectorAll(
            "button, [role=button], a[href]"
          )].filter(visible);
          const resolvedAriaName = (el) => {
            const ids = (el.getAttribute("aria-labelledby") || "").trim()
              .split(/\s+/).filter(Boolean);
            return ids.length > 0 && ids.every(id =>
              Boolean(document.getElementById(id)?.textContent?.trim())
            );
          };
          const labeled = (el) => {
            if ((el.getAttribute("aria-label") || "").trim() ||
                resolvedAriaName(el)) return true;
            if ([...(el.labels || [])].some(label => label.textContent?.trim())) return true;
            if (el.closest("label")?.textContent?.trim()) return true;
            return Boolean(el.getAttribute("title")?.trim());
          };
          const namedAction = (el) => {
            if ((el.getAttribute("aria-label") || "").trim() ||
                resolvedAriaName(el) || (el.getAttribute("title") || "").trim()) return true;
            // Never count hidden SVG title/text as an accessible button name.
            // This is a boolean-only heuristic, not a full screen-reader audit.
            const copy = el.cloneNode(true);
            copy.querySelectorAll('[aria-hidden="true"],[hidden],[inert],script,style')
              .forEach(node => node.remove());
            if ((copy.textContent || "").trim()) return true;
            return Boolean(copy.querySelector("img[alt]:not([alt=''])"));
          };
          const dialogs = [...document.querySelectorAll(
            '[role="dialog"],[role="alertdialog"]'
          )].filter(visible);
          // Do not inspect or persist heading text. Only verify that a
          // visible dialog is modal and its accessible name resolves to
          // actual DOM text rather than a dangling aria-labelledby ID.
          const dialogNamed = (el) => {
            const label = el.getAttribute("aria-label");
            if (label?.trim()) return true;
            return resolvedAriaName(el);
          };
          const dialogA11yIssueCount = dialogs.filter(el =>
            el.getAttribute("aria-modal") !== "true" || !dialogNamed(el)
          ).length;
          const viewportWidth = document.documentElement.clientWidth;
          const clipped = [...controls, ...actions].filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 &&
              (rect.left < -12 || rect.right > viewportWidth + 12);
          }).length;
          return {
            lang: document.documentElement.lang,
            direction: document.documentElement.dir || getComputedStyle(document.body).direction,
            theme: document.documentElement.dataset.theme || "",
            overflow: document.documentElement.scrollWidth > window.innerWidth + 12,
            body: Boolean(document.querySelector("body")?.textContent?.trim()),
            readyState: document.readyState,
            fontsReady: document.fonts.status === "loaded",
            visibleBusySurfaceCount: [...document.querySelectorAll(
              '[aria-busy="true"],[role="progressbar"],[data-loading="true"]'
            )].filter(visible).length,
            renderedFormCount: document.querySelectorAll("form").length,
            renderedActionCount: actions.length,
            visibleDialogCount: dialogs.length,
            dialogA11yIssueCount,
            unlabeledInputCount: controls.filter(el => !labeled(el)).length,
            unlabeledActionCount: actions.filter(el => !namedAction(el)).length,
            interactiveViewportClippingCount: clipped,
          };
        });
        documentLang = info.lang;
        documentDirection = info.direction;
        documentTheme = info.theme;
        documentFullyLoaded = info.readyState === "complete" && info.fontsReady;
        documentBodyHasContent = info.body;
        visibleBusySurfaceCount = info.visibleBusySurfaceCount;
        horizontalOverflow = info.overflow;
        renderedFormCount = info.renderedFormCount;
        renderedActionCount = info.renderedActionCount;
        visibleDialogCount = info.visibleDialogCount;
        unlabeledInputCount = info.unlabeledInputCount;
        unlabeledActionCount = info.unlabeledActionCount;
        interactiveViewportClippingCount = info.interactiveViewportClippingCount;
        dialogA11yIssueCount = info.dialogA11yIssueCount;
        if (responseStatus === null || responseStatus >= 400) issues.push("HTTP_NON_SUCCESS");
        if (!info.body) issues.push("EMPTY_DOCUMENT");
        if (!documentFullyLoaded) issues.push("DOCUMENT_NOT_FULLY_LOADED");
        if (visibleBusySurfaceCount) issues.push("VISIBLE_LOADING_SURFACE_UNRESOLVED");
        if (info.overflow) issues.push("HORIZONTAL_VIEWPORT_OVERFLOW");
        if (info.unlabeledInputCount) issues.push("VISIBLE_INPUT_ACCESSIBLE_NAME_MISSING");
        if (info.unlabeledActionCount) issues.push("VISIBLE_ACTION_ACCESSIBLE_NAME_MISSING");
        if (info.interactiveViewportClippingCount) issues.push("INTERACTIVE_CONTROL_CLIPPED");
        if (info.dialogA11yIssueCount) issues.push("VISIBLE_DIALOG_ACCESSIBLE_NAME_OR_MODAL_MISSING");
        if (documentLang.toLowerCase().split("-")[0] !== scenario.locale) {
          issues.push("HTML_LANGUAGE_MISMATCH");
        }
        if (documentDirection !== scenario.direction) {
          issues.push("HTML_DIRECTION_MISMATCH");
        }
        if (documentTheme !== scenario.scheme) {
          issues.push("DOCUMENT_THEME_MISMATCH");
        }
        // A redirected login / portal screen cannot stand as evidence for a protected route.
        // Redirect-only entry screens are captured but require human adjudication.
        if (!navigationTargetMatched) {
          issues.push("ROUTE_REDIRECTED_REVIEW_REQUIRED");
          if (finalRoute === "/login" || finalRoute === "/portal/login") {
            issues.push("REDIRECTED_TO_LOGIN");
          }
        }
        if (pageErrorCount) issues.push("RUNTIME_ERRORS");
        imageName = path.basename(photoFile(images, route, name));
        await page.screenshot({
          path:path.join(images,imageName),fullPage:true,animations:"disabled",timeout:30000,
        });
        // Tie the evidence record to the actual PNG bytes rather than trusting
        // a reusable route/scenario filename from an earlier staging sweep.
        evidenceSha256 = createHash("sha256")
          .update(fs.readFileSync(path.join(images,imageName))).digest("hex");
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
        navigationTargetMatched,documentFullyLoaded,documentBodyHasContent,
        visibleBusySurfaceCount,
        htmlLanguage:documentLang,htmlDirection:documentDirection,
        htmlTheme:documentTheme,horizontalOverflow,uncaughtRuntimeErrorCount:pageErrorCount,
        renderedFormCount,renderedActionCount,visibleDialogCount,
        unlabeledInputCount,unlabeledActionCount,interactiveViewportClippingCount,
        dialogA11yIssueCount,
        evidenceImage:imageName,evidenceSha256,
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
  } else if (process.argv.includes("--preflight")) {
    const manifest = readManifest();
    const base = stagingOrigin(process.env.FL_UI_AUDIT_STAGING_ORIGIN);
    const config = loadFixtureConfig(manifest, base);
    const cases = coverageCases(manifest, base, config);
    console.log("Private synthetic browser preflight PASSED: " + cases.length + " cases for " + manifest.routes.length + " routes; no browser launched, no screenshots created, no acceptance claimed.");
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
