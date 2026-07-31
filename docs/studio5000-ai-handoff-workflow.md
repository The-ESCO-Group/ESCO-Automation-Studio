# Studio 5000 AI Handoff Workflow

ESCO Automation Studio can now act as the offline AI workspace for Logix-style
projects while keeping the Rockwell controller-transfer boundary explicit.

## What ESCO Handles

- Import `.L5X` XML review files into the ESCO project model.
- Let AI propose reviewed offline edits: tags, ladder rungs, routines, programs,
  tasks, controller metadata, and supported HMI content.
- Apply AI changes only through the whitelisted project-action layer.
- Run ESCO validation and offline simulation.
- Export a review-only `.L5X` file.
- Show an `L5X Handoff` dock panel with:
  - Studio 5000 handoff readiness.
  - Project counts and validation counts.
  - The import/export audit receipt.
  - Kept, preserved-not-executed, and changed interchange rows.
  - The no `.ACD`, no hardware upload/download boundary.
- Probe and preflight an optional Logix Designer SDK workstation lane through
  the backend API. This lane can stage sandbox open/export, component
  import/export, and project conversion receipts, but it does not expose
  controller transfer routes.

## What Studio 5000 Still Handles

- Opening or importing the exported `.L5X` into a Rockwell project.
- Vendor verification/compile in a sandbox project.
- Going online with a physical controller.
- Upload/download, online edits, mode changes, and real controller transfer.
- Proprietary `.ACD` project storage.

## User Flow

1. Import an `.L5X`, open an ESCO project, or create a new offline project.
2. Ask the assistant for logic, structure, review, or handoff readiness help.
3. Review and apply proposed AI actions.
4. Open `File / Import / Export / L5X Handoff Receipt`.
5. Resolve readiness warnings and validation errors.
6. Export `L5X (Review Only)`.
7. Review the generated handoff receipt.
8. Open/import the `.L5X` in Studio 5000 and use Rockwell-approved tooling for
   the physical PLC upload/download path.

## Optional SDK Preflight

The API host exposes guarded Logix Designer SDK status and handoff preflight
routes under `/api/logix-designer-sdk`. See `docs/logix-designer-sdk-handoff.md`.
