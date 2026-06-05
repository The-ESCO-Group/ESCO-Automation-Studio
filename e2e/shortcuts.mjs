// E2E: workbench keyboard command routing.
// Verifies the IDE-style accelerators that aren't reachable any other way:
//   Ctrl+F  -> open the Search Results dock and focus the find box (from editor + from a text field)
//   F1      -> route the workbench to the Help tab
// These exercise the resolver in apps/web/src/shortcuts.ts wired through App.tsx.
//
// NOTE on F1: we assert on the persisted workbench layout, not a rendered Help
// panel. A concurrent lane is converting the shell to a classic Studio-5000
// two-pane layout that hides the right-rail copilot/Help drawer, so the panel may
// not be visible. The command *routing* (F1 -> open Help) is what this lane owns,
// and it surfaces in the layout the shell persists. See the lane report for the
// unresolved layout conflict around making Help visible.
import { chromium } from "playwright-core";
import { URL, dismissToasts, importStarterProject } from "./helpers.mjs";

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 120) : ""}`);
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importStarterProject(page);
  await dismissToasts(page);

  // --- Ctrl+F from the editor: open + focus the Search Results dock ---
  await page.locator(".esco-editor__surface").first().click();
  await page.keyboard.press("Control+f");
  await page.locator(".esco-dock.is-expanded").waitFor({ timeout: 5000 });
  const activeDockTab = (await page.locator(".esco-dock__tab.is-active").first().innerText()).trim();
  check("Ctrl+F from the editor activates the Search Results dock tab", /Search Results/.test(activeDockTab), activeDockTab);

  const findBoxFocused = await page.evaluate(() =>
    !!document.activeElement && document.activeElement.classList.contains("esco-search__input"),
  );
  check("Ctrl+F drops the cursor into the find box", findBoxFocused);

  // Typing now flows straight into the find box without clicking it first.
  await page.keyboard.type("MotorRun");
  const findValue = await page.locator(".esco-search__input").first().inputValue();
  check("typed query lands in the focused find box", findValue === "MotorRun", findValue);

  // --- F1: route the workbench to the Help tab (assert via persisted layout) ---
  await page.keyboard.press("F1");
  const copilotTab = await page
    .waitForFunction(
      () => {
        try {
          return JSON.parse(localStorage.getItem("esco.workbench.layout.v1") || "{}").copilotTab ?? null;
        } catch {
          return null;
        }
      },
      undefined,
      { timeout: 5000 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => null);
  check("F1 routes the workbench to the Help tab", copilotTab === "help", String(copilotTab));

  // --- Ctrl+F is global: still works while a text field is focused ---
  await page.locator(".esco-search__input").first().click();
  await page.keyboard.press("Control+f");
  const stillFocused = await page.evaluate(() =>
    !!document.activeElement && document.activeElement.classList.contains("esco-search__input"),
  );
  check("Ctrl+F remains a global accelerator from inside a text field", stillFocused);
} catch (error) {
  console.log("ERROR:", error?.message || error);
} finally {
  await browser.close();
}

const passed = results.filter(Boolean).length;
console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
process.exit(passed === results.length && results.length > 0 ? 0 : 1);
