// E2E: ESCO artifact validation and self-contained package round-trip. Validates
// runtime/component files, exports an embedded .easpkg, imports its project
// entry back, and keeps all work in the offline ESCO-native file family.
import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { URL, importStarterProject } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const runtimePath = join(here, "validator-runtime.easruntime");
const routinePath = join(here, "validator-routine.esco-routine.json");
const packagePath = join(here, "validator-package.easpkg");
const tamperedPackagePath = join(here, "validator-package-tampered.easpkg");

const results = [];
const check = (label, condition, detail = "") => {
  results.push(!!condition);
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 160) : ""}`);
};

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const fileMenuItem = (page, label) => page.locator(`.esco-ribbon-menu__item:has-text("${label}")`).first();

async function clickFileMenuItem(page, label) {
  await page.locator('.esco-ribbon__tab:has-text("File")').click();
  await page.locator(".esco-ribbon-menu").waitFor({ timeout: 5000 });
  await fileMenuItem(page, label).click();
}

async function dismissToasts(page) {
  while ((await page.locator(".esco-toast__close").count()) > 0) {
    await page.locator(".esco-toast__close").first().click();
  }
}

async function validateFile(page, filePath) {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    clickFileMenuItem(page, "Validate ESCO Package / Runtime Files"),
  ]);
  await chooser.setFiles(filePath);
}

async function artifactReviewText(page) {
  const review = page.locator('[aria-label="ESCO artifact validation review"]');
  await review.waitFor({ timeout: 8000 });
  return review.innerText();
}

async function exportRoutineComponent(page) {
  await page.locator('.esco-tree__node--routine:has-text("MainRoutine")').first().click({ button: "right" });
  await page.locator(".esco-context-menu--organizer").waitFor({ timeout: 5000 });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('.esco-context-menu__item:has-text("Export Routine")').click(),
  ]);
  await download.saveAs(routinePath);
  return download.suggestedFilename();
}

async function exportRuntime(page) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    clickFileMenuItem(page, "Export ESCO Runtime"),
  ]);
  await download.saveAs(runtimePath);
  return download.suggestedFilename();
}

async function exportPackage(page) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    clickFileMenuItem(page, "Export ESCO Package"),
  ]);
  await download.saveAs(packagePath);
  return download.suggestedFilename();
}

async function importPackage(page, filePath) {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    clickFileMenuItem(page, "Import ESCO Package"),
  ]);
  await chooser.setFiles(filePath);
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importStarterProject(page);
  await dismissToasts(page);
  const titleBefore = await page.locator(".esco-titlebar__name").innerText();

  const runtimeName = await exportRuntime(page);
  check("Export ESCO Runtime produced a runtime artifact", runtimeName.endsWith(".easruntime"), runtimeName);
  await dismissToasts(page);

  await validateFile(page, runtimePath);
  await page.locator('.esco-toast:has-text("Validated ESCO Runtime")').waitFor({ timeout: 8000 });
  check("Validator accepts a downloaded ESCO Runtime", /Validated ESCO Runtime/.test(await page.locator(".esco-toast").last().innerText()));
  const runtimeReview = await artifactReviewText(page);
  check(
    "Build dock persists ESCO Runtime validation review",
    /ESCO Artifact Validation/.test(runtimeReview) &&
      /ESCO Runtime/.test(runtimeReview) &&
      /Passed/i.test(runtimeReview) &&
      /Checksum\s+valid/i.test(runtimeReview) &&
      /No project changes made/i.test(runtimeReview),
    runtimeReview,
  );
  await dismissToasts(page);

  const routineName = await exportRoutineComponent(page);
  check("Export Routine produced an ESCO component artifact", routineName.endsWith(".esco-routine.json"), routineName);
  await dismissToasts(page);

  await validateFile(page, routinePath);
  await page.locator('.esco-toast:has-text("Validated ESCO component")').waitFor({ timeout: 8000 });
  check("Validator accepts an ESCO component export", /payload item/.test(await page.locator(".esco-toast").last().innerText()));
  const componentReview = await artifactReviewText(page);
  check(
    "Build dock persists ESCO component validation review",
    /ESCO component/.test(componentReview) &&
      /Payloads\s+1/.test(componentReview) &&
      /No project changes made/i.test(componentReview),
    componentReview,
  );
  await dismissToasts(page);

  const packageName = await exportPackage(page);
  check("Export ESCO Package produced a package artifact", packageName.endsWith(".easpkg"), packageName);
  await dismissToasts(page);

  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  const artifactByPath = new Map(packageJson.artifacts.map((artifact) => [artifact.path, artifact.text]));
  check("Exported package embeds artifact content", packageJson.contentMode === "embedded" && packageJson.artifacts.length === packageJson.entries.length);
  check("Exported package includes editable project and runtime entries", packageJson.entries.some((entry) => entry.path.endsWith(".easproj")) && packageJson.entries.some((entry) => entry.path.endsWith(".easruntime")));
  check(
    "Exported package entry byte counts and checksums match embedded content",
    packageJson.entries.every((entry) => {
      const text = artifactByPath.get(entry.path);
      return text != null && entry.bytes === Buffer.byteLength(text, "utf8") && entry.checksum.value === sha256(text);
    }),
  );

  await validateFile(page, packagePath);
  await page.locator('.esco-toast:has-text("Validated ESCO package")').waitFor({ timeout: 8000 });
  const packageToast = await page.locator(".esco-toast").last().innerText();
  check("Validator accepts a deterministic embedded ESCO package", /2 entries/.test(packageToast), packageToast);
  const packageReview = await artifactReviewText(page);
  check(
    "Build dock persists embedded package validation review",
    /ESCO package/.test(packageReview) &&
      /Passed/i.test(packageReview) &&
      /Entries\s+2/.test(packageReview) &&
      /Artifacts\s+2/.test(packageReview) &&
      /embedded verified/i.test(packageReview) &&
      /\.easproj/.test(packageReview) &&
      /\.easruntime/.test(packageReview) &&
      /No project changes made/i.test(packageReview),
    packageReview,
  );
  await dismissToasts(page);

  await importPackage(page, packagePath);
  await page.locator('.esco-toast:has-text("Imported ESCO Package")').waitFor({ timeout: 8000 });
  check("Package import opens the embedded editable project", (await page.locator(".esco-titlebar__name").innerText()) === titleBefore);
  await dismissToasts(page);

  const titleAfter = await page.locator(".esco-titlebar__name").innerText();
  check("Validation is non-mutating and keeps the active project loaded", titleAfter === titleBefore, titleAfter);

  const tampered = {
    ...packageJson,
    artifacts: packageJson.artifacts.map((artifact, index) =>
      index === 0 ? { ...artifact, text: `${artifact.text}\n` } : artifact,
    ),
  };
  await writeFile(tamperedPackagePath, JSON.stringify(tampered, null, 2));
  await validateFile(page, tamperedPackagePath);
  await page.locator('.esco-toast:has-text("checksum does not match")').waitFor({ timeout: 8000 });
  const tamperedReview = await artifactReviewText(page);
  check(
    "Validator rejects tampered embedded ESCO packages with persistent review",
    /Failed/i.test(tamperedReview) &&
      /checksum does not match/i.test(tamperedReview) &&
      /Expected\s+[0-9a-f]{16}\.\.\./i.test(tamperedReview) &&
      /Actual\s+[0-9a-f]{16}\.\.\./i.test(tamperedReview),
    tamperedReview,
  );
  await dismissToasts(page);

  const [badChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    clickFileMenuItem(page, "Validate ESCO Package / Runtime Files"),
  ]);
  await badChooser.setFiles({
    name: "review.L5X",
    mimeType: "application/xml",
    buffer: Buffer.from("<Controller/>"),
  });
  await page.locator('.esco-toast:has-text("Not an ESCO artifact")').waitFor({ timeout: 8000 });
  const rejectedReview = await artifactReviewText(page);
  check(
    "Validator rejects non-ESCO artifact files with persistent review",
    /Rejected artifact/.test(rejectedReview) &&
      /Failed/i.test(rejectedReview) &&
      /Not an ESCO artifact/i.test(rejectedReview) &&
      /No project changes made/i.test(rejectedReview),
    rejectedReview,
  );

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  console.log("ERROR:", error.message);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
