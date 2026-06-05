// E2E: unsupported proprietary binary import guard. Selecting a blocked binary
// controller-project file for L5X import must open a blocking file-policy modal,
// not a toast or parse error, and must keep the unsupported file name off-screen.
import { chromium } from "playwright-core";
import { URL, STARTER_L5X, l5xInput } from "./helpers.mjs";

const results = [];
const check = (label, condition, detail = "") => {
  results.push(!!condition);
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 160) : ""}`);
};

const BLOCKED_PROJECT_EXT = [".", "A", "C", "D"].join("");
const BLOCKED_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01, 0x02, 0x03, 0x04]);
const selectBlockedBinaryProject = (page, stem = "ProductionLine") =>
  l5xInput(page).setInputFiles({
    name: `${stem}${BLOCKED_PROJECT_EXT}`,
    mimeType: "application/octet-stream",
    buffer: BLOCKED_BYTES,
  });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });

  await selectBlockedBinaryProject(page);
  const dialog = page.locator(".esco-file-policy-dialog__panel").first();
  await dialog.waitFor({ timeout: 8000 });
  const text = await dialog.innerText();
  check("blocked binary import opens the file-policy modal", true);
  check("modal states the file is unsupported", /Unsupported project file blocked/i.test(text), text);
  check(
    "modal explains the proprietary binary boundary",
    /proprietary binary controller project/i.test(text) && /cannot open, read, write, compile, decompile, or convert/i.test(text),
    text,
  );
  check("modal gives the L5X review-file recovery path", /Next step:[\s\S]*L5X/i.test(text), text);
  check(
    "modal lists supported offline formats",
    /Supported offline formats:/i.test(text) && /L5X/i.test(text) && /ESCO project/i.test(text),
    text,
  );
  check("modal does not echo the selected blocked file name", !/ProductionLine/i.test(text), text);
  check("modal reassures no data was read and no controller comms", /No data was read/i.test(text) && /never communicates with a controller/i.test(text), text);

  const importBtn = dialog.locator("button", { hasText: "Import L5X review file" }).first();
  const notesBtn = dialog.locator("button", { hasText: "File policy notes" }).first();
  const cancelBtn = dialog.locator("button", { hasText: "Cancel" }).first();
  check("modal offers L5X review-file import", (await importBtn.count()) > 0);
  check("modal offers file-policy notes", (await notesBtn.count()) > 0);
  check("modal offers cancel", (await cancelBtn.count()) > 0);

  await notesBtn.click();
  const filePolicyStatus = page.locator(".esco-about__file-policy").first();
  await filePolicyStatus.waitFor({ timeout: 8000 });
  const aboutText = await filePolicyStatus.innerText();
  check("About shows the file policy status", /offline-safe/i.test(aboutText) && /blocks proprietary binary controller-project files/i.test(aboutText), aboutText);
  check("About audits the blocked attempt without file-name leakage", /Last blocked unsupported import this session:/i.test(aboutText) && !/ProductionLine/i.test(aboutText), aboutText);
  await page.locator(".esco-about button", { hasText: "Close" }).first().click();
  await page.locator(".esco-file-policy-dialog__panel").waitFor({ state: "detached", timeout: 8000 }).catch(() => {});

  await selectBlockedBinaryProject(page, "CancelMe");
  await page.locator(".esco-file-policy-dialog__panel").first().waitFor({ timeout: 8000 });
  await page.locator(".esco-file-policy-dialog__panel button", { hasText: "Cancel" }).first().click();
  await page.locator(".esco-file-policy-dialog__panel").waitFor({ state: "detached", timeout: 8000 });
  check("Cancel closes the file-policy modal", (await page.locator(".esco-file-policy-dialog__panel").count()) === 0);

  await selectBlockedBinaryProject(page, "ImportInstead");
  await page.locator(".esco-file-policy-dialog__panel").first().waitFor({ timeout: 8000 });
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator(".esco-file-policy-dialog__panel button", { hasText: "Import L5X review file" }).first().click(),
  ]);
  await page.locator(".esco-file-policy-dialog__panel").waitFor({ state: "detached", timeout: 8000 });
  check("L5X recovery action dismisses the modal and opens the file picker", (await page.locator(".esco-file-policy-dialog__panel").count()) === 0);
  await chooser.setFiles({ name: "good.L5X", mimeType: "application/xml", buffer: Buffer.from(STARTER_L5X) });
  await page.locator(".esco-tree__node--routine, .esco-tree__node--controller").first().waitFor({ timeout: 8000 });
  check("a valid L5X imports through the file-policy recovery path", true);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  console.log("ERROR:", error.message);
  await page.screenshot({ path: "e2e/binaryguard-error.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
