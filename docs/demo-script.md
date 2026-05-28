# Demo Script

A 5–10 minute walkthrough for showing ESCO Automation Studio to a mentor.

## Setup

```bash
corepack pnpm install
corepack pnpm dev
```

Open http://localhost:5173. The **Welcome dashboard** appears. Point out the
title bar: project name, current routine, validation status, and the **● Offline**
badge.

> Opening line: *"This is an offline PLC engineering tool — it edits, simulates,
> validates, and imports Studio 5000 logic. It does not talk to any controller
> and never touches `.ACD` files."*

## Demo 1 — Simulate the seal-in motor starter

1. Click **Open Demo Routine** (or `MainRoutine` in the Project Explorer).
2. Bottom dock → **Watch** tab. Note `StartPB`/`StopPB` are inputs (Toggle),
   `MotorRun` is an output (read-only).
3. Toggle **StartPB** on → **Scan Once** → `MotorRun = true`.
4. Toggle **StartPB** off → **Scan Once** → `MotorRun` stays on (sealed in).
5. Toggle **StopPB** on → **Scan Once** → `MotorRun = false`.

## Demo 2 — Edit a rung

1. Click **+ Add Rung** (it is auto-selected).
2. From the grouped palette add **XIC**, then **MOV**, then **TON**.
3. Fill operands inline, e.g. `XIC(StartPB)`, `MOV(123, Count)`, `TON(T1, 1000)`.
4. Undefined tags show a **+ Create …** button (correct type inferred).
5. **Watch → Scan Once** (a few times for the timer) and observe the values.

## Demo 3 — AI assistant generates a motor starter

1. Bottom dock → **AI Assistant**.
2. Click **Generate motor starter** (or type "generate motor starter").
3. Review the proposed-action preview (Create tags + Add rung).
4. Click **Apply actions** → see "Applied successfully" + validation summary.
5. Emphasize: *"The assistant never edits the project directly — it proposes
   actions I apply through the controlled action layer."*

## Demo 4 — Import an L5X file

1. Title bar → **Import L5X**, choose a `.L5X` export.
2. A toast shows the import summary (programs / routines / rungs / tags /
   unsupported instructions / warnings). The same summary stays on the
   Dashboard.
3. Open the imported routine; unsupported instructions render as dashed
   read-only boxes.

## Demo 5 — Cross reference

1. Select a tag in the Project Explorer.
2. Bottom dock → **Cross Ref**: every place the tag is used (routine, rung,
   instruction, operand, read/write badge).
3. Click a reference to jump to its routine.

## Demo 6 — Export / import the project

1. Title bar → **Export Project** → downloads `<name>.plcproj.json`.
2. **Import Project** → re-load it; the ladder AST round-trips exactly.

## What to tell the mentor

- This is **offline and safe** — it is not controlling hardware.
- It **imports** L5X but does **not** modify `.ACD` files and has no L5X export.
- The **AI** is local/rule-based (no API key) and only edits through the
  controlled `project-actions` layer, with a preview-then-apply workflow.
