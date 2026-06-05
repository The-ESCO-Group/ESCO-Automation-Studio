import { chromium } from "playwright-core";
import { URL, dismissToasts, importL5XText } from "./helpers.mjs";

const PROGRAM_COUNT = 120;
const programs = Array.from({ length: PROGRAM_COUNT }, (_, index) => {
  const suffix = String(index).padStart(3, "0");
  return `<Program Name="Program_${suffix}" MainRoutineName="Main_${suffix}">
    <Routines>
      <Routine Name="Main_${suffix}" Type="RLL">
        <RLLContent><Rung Number="0"><Text><![CDATA[NOP();]]></Text></Rung></RLLContent>
      </Routine>
    </Routines>
  </Program>`;
}).join("");

const LARGE_ORGANIZER_L5X = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="LargeOrganizer_E2E" ContentType="Controller">
  <Controller Use="Target" Name="LargeOrganizer_E2E">
    <Tags><Tag Name="Bit0" TagType="Base" DataType="BOOL"/></Tags>
    <Programs>${programs}</Programs>
  </Controller>
</RSLogix5000Content>`;

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 140) : ""}`);
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importL5XText(page, LARGE_ORGANIZER_L5X, "large-organizer.L5X");
  await dismissToasts(page);
  await page.locator('.esco-titlebar__name:has-text("LargeOrganizer_E2E")').waitFor({ timeout: 8000 });

  const organizer = page.locator(".esco-controller-organizer");
  const filter = organizer.locator('[aria-label="Filter Controller Organizer"]');
  await filter.waitFor({ timeout: 8000 });
  const text = await organizer.innerText();

  check("organizer exposes a live filter and model counts", /120 programs/.test(text) && /120 routines/.test(text), text);
  check("large-project organizer mode is visible", /Large project: organizer branches are capped/i.test(text), text);
  check("initial organizer hides rows past the cap", /Program_000/.test(text) && !/Program_119/.test(text), text);
  check("hidden-count row reports capped programs", /Showing first 80 of 120 programs/i.test(text), text);

  await filter.fill("Program_119");
  const filteredText = await organizer.innerText();
  check("organizer filter reveals a previously capped program", /Program_119/.test(filteredText), filteredText);
  check("organizer filter narrows visible program list", !/Program_000/.test(filteredText), filteredText);

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
