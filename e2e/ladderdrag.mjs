import { chromium } from "playwright-core";
import { URL, importStarterProject, dismissToasts } from "./helpers.mjs";

// Native HTML5 drag-and-drop isn't driven by Playwright's mouse-based dragTo, so
// we reproduce a real drag by dispatching dragstart/dragover/drop with a single
// shared DataTransfer — exactly the event sequence the browser fires. This
// exercises the real React onDragStart/onDrop handlers in LadderView.

const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  - " + d : ""}`); };
const order = (page) =>
  page.$$eval(".esco-lad__rung.is-selected input.esco-lad__operand", (els) => els.map((el) => el.value));

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importStarterProject(page);
  await page.locator(".esco-lad__rung").first().click();
  await dismissToasts(page);
  check("starter rung loads in series order", JSON.stringify(await order(page)) === JSON.stringify(["StartPB", "StopPB", "MotorRun"]), JSON.stringify(await order(page)));

  // Each instruction exposes a drag handle once the editor is editable.
  check("instructions expose a drag handle", (await page.locator(".esco-lad__drag-handle").count()) >= 3);

  // Drag StartPB's handle and drop it on the RIGHT half of StopPB → after StopPB.
  const moved = await page.evaluate(() => {
    const nodeWith = (val) =>
      [...document.querySelectorAll(".esco-lad__rung.is-selected .esco-lad__node")].find(
        (el) => el.querySelector(`input.esco-lad__operand[value="${val}"]`),
      );
    const start = nodeWith("StartPB");
    const stop = nodeWith("StopPB");
    const handle = start?.querySelector(".esco-lad__drag-handle");
    if (!handle || !stop) return { ok: false, reason: "elements not found" };
    const dt = new DataTransfer();
    const rect = stop.getBoundingClientRect();
    const x = rect.left + rect.width * 0.9; // right half → insert "after"
    const y = rect.top + rect.height / 2;
    const fire = (el, type, extra = {}) =>
      el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, ...extra }));
    fire(handle, "dragstart", { clientX: 0, clientY: 0 });
    fire(stop, "dragenter", { clientX: x, clientY: y });
    fire(stop, "dragover", { clientX: x, clientY: y });
    fire(stop, "drop", { clientX: x, clientY: y });
    fire(handle, "dragend", { clientX: x, clientY: y });
    return { ok: true };
  });
  if (!moved.ok) check("drag dispatch found the elements", false, moved.reason);

  await page.waitForFunction(
    () => {
      const v = [...document.querySelectorAll(".esco-lad__rung.is-selected input.esco-lad__operand")].map((e) => e.value);
      return v.join(",") === "StopPB,StartPB,MotorRun";
    },
    undefined,
    { timeout: 8000 },
  ).catch(() => {});
  check("drag-and-drop reorders the instruction after the drop target", JSON.stringify(await order(page)) === JSON.stringify(["StopPB", "StartPB", "MotorRun"]), JSON.stringify(await order(page)));

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
