import { chromium } from "playwright-core";
import { URL, dismissToasts, importL5XText } from "./helpers.mjs";

const L5X = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="CadenceCtl" ContentType="Controller">
  <Controller Use="Target" Name="CadenceCtl">
    <Tags>
      <Tag Name="FastCount" TagType="Base" DataType="DINT"/>
      <Tag Name="SlowCount" TagType="Base" DataType="DINT"/>
      <Tag Name="EventCount" TagType="Base" DataType="DINT"/>
    </Tags>
    <Programs>
      <Program Name="FastProgram" MainRoutineName="FastRoutine">
        <Routines>
          <Routine Name="FastRoutine" Type="ST">
            <STContent><Line Number="0"><![CDATA[FastCount := FastCount + 1;]]></Line></STContent>
          </Routine>
        </Routines>
      </Program>
      <Program Name="SlowProgram" MainRoutineName="SlowRoutine">
        <Routines>
          <Routine Name="SlowRoutine" Type="ST">
            <STContent><Line Number="0"><![CDATA[SlowCount := SlowCount + 1;]]></Line></STContent>
          </Routine>
        </Routines>
      </Program>
      <Program Name="EventProgram" MainRoutineName="EventRoutine">
        <Routines>
          <Routine Name="EventRoutine" Type="ST">
            <STContent><Line Number="0"><![CDATA[EventCount := EventCount + 1;]]></Line></STContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
    <Tasks>
      <Task Name="FastPeriodic" Type="PERIODIC" Rate="250" Priority="1">
        <ScheduledPrograms><ScheduledProgram Name="FastProgram"/></ScheduledPrograms>
      </Task>
      <Task Name="SlowPeriodic" Type="PERIODIC" Rate="750" Priority="5">
        <ScheduledPrograms><ScheduledProgram Name="SlowProgram"/></ScheduledPrograms>
      </Task>
      <Task Name="HeldEvent" Type="EVENT" Priority="10">
        <EventInfo EventTrigger="EVENT Instruction Only" EnableTimeout="false"/>
        <ScheduledPrograms><ScheduledProgram Name="EventProgram"/></ScheduledPrograms>
      </Task>
    </Tasks>
  </Controller>
</RSLogix5000Content>`;

const results = [];
const check = (label, condition, detail = "") => {
  results.push(!!condition);
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 150) : ""}`);
};

const taskRow = (page, taskName) => page.locator(`.esco-task-monitor__table tbody tr:has-text("${taskName}")`);
const taskScans = async (page, taskName) =>
  Number(await taskRow(page, taskName).locator(".esco-task-monitor__scans").getAttribute("data-scan-count"));
const monitorText = async (page) => (await page.locator(".esco-task-monitor").innerText()).replace(/\s+/g, " ");

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(10000);
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importL5XText(page, L5X, "task-cadence.L5X");
  await dismissToasts(page);

  await page.locator('.esco-left :text("Tasks")').first().click({ button: "right" });
  await page.locator(".esco-context-menu--organizer").waitFor();
  await page.locator('.esco-context-menu__item:has-text("Monitor Tasks")').click();
  await page.locator('.esco-dock__tab.is-active:has-text("Task Monitor")').waitFor();
  await taskRow(page, "FastPeriodic").waitFor();

  const initialText = await monitorText(page);
  check(
    "Task Monitor shows imported periodic and held EVENT tasks",
    /FastPeriodic/.test(initialText) &&
      /SlowPeriodic/.test(initialText) &&
      /HeldEvent/.test(initialText) &&
      /250 ms/.test(initialText) &&
      /750 ms/.test(initialText) &&
      /event trigger metadata preserved; event dispatch is not simulated/i.test(initialText),
    initialText,
  );

  for (let index = 0; index < 3; index += 1) {
    await page.locator('.esco-task-monitor .esco-btn:has-text("Scan Once")').click();
  }
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll(".esco-task-monitor__table tbody tr")).some((row) =>
      /FastPeriodic/.test(row.textContent ?? "") &&
      Number(row.querySelector(".esco-task-monitor__scans")?.getAttribute("data-scan-count")) >= 3,
    ),
  );

  check("Fast periodic task releases every 250 ms scan tick", (await taskScans(page, "FastPeriodic")) === 3);
  check("Slow periodic task releases only once across three 250 ms ticks", (await taskScans(page, "SlowPeriodic")) === 1);
  check("EVENT task remains held without a simulated trigger", (await taskScans(page, "HeldEvent")) === 0);

  await page.locator('.esco-task-monitor .esco-btn:has-text("Scan Once")').click();
  check("Slow periodic task releases on the fourth modeled tick", (await taskScans(page, "SlowPeriodic")) === 2);

  await taskRow(page, "HeldEvent").locator('.esco-btn:has-text("Trigger")').click();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll(".esco-task-monitor__table tbody tr")).some((row) =>
      /HeldEvent/.test(row.textContent ?? "") &&
      Number(row.querySelector(".esco-task-monitor__scans")?.getAttribute("data-scan-count")) >= 1,
    ),
  );
  check("EVENT task scans once when explicitly triggered in offline software", (await taskScans(page, "HeldEvent")) === 1);

  await page.locator('.esco-task-monitor .esco-btn:has-text("Reset Task Stats")').click();
  await page.waitForFunction(() =>
    Number(document.querySelector(".esco-task-monitor__table tbody tr .esco-task-monitor__scans")?.getAttribute("data-scan-count")) === 0,
  );
  check(
    "Reset Task Stats resets scheduler cadence and per-task counters",
    (await taskScans(page, "FastPeriodic")) === 0 &&
      (await taskScans(page, "SlowPeriodic")) === 0 &&
      (await taskScans(page, "HeldEvent")) === 0,
  );

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  console.log("ERROR:", error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
