# Logix Designer SDK Handoff Lane

This is the first ESCO integration slice for Rockwell's Studio 5000 Logix
Designer SDK. It is intentionally a guarded backend-only handoff lane.

## What This Slice Does

- Probes for a local Logix Designer SDK installation.
- Checks the documented default SDK root:
  `C:\Users\Public\Documents\Studio 5000\Logix Designer SDK`.
- Supports an override with `ESCO_LOGIX_DESIGNER_SDK_ROOT`.
- Reports Python and C# client readiness evidence.
- Builds a dry-run handoff plan for SDK workstation operations such as:
  - open sandbox project and export review `.L5X`;
  - export selected components to `.L5X`;
  - import selected components into an offline sandbox copy;
  - convert a sandbox project to an installed Logix Designer major revision.
- Returns a small Python import probe and runner manifest for the future SDK
  workstation companion.

## What This Slice Blocks

The API does not expose SDK routes for:

- physical PLC download;
- go online;
- online edit;
- controller mode change;
- SD card deployment;
- physical forces;
- fault clear.

Those operations remain in Studio 5000 or approved Rockwell tooling with human
engineering controls.

## API Routes

Start the API host:

```powershell
corepack pnpm --filter @esco/api dev
```

Probe SDK status:

```powershell
Invoke-RestMethod http://localhost:4000/api/logix-designer-sdk/status
```

Build an open/export handoff preflight:

```powershell
Invoke-RestMethod `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"operation":"open-export-l5x","sourceProjectPath":"C:\\sandbox\\line.L5X","outputPath":"C:\\sandbox\\line-reviewed.L5X"}' `
  http://localhost:4000/api/logix-designer-sdk/handoff/preflight
```

Explicit transfer routes are closed:

```powershell
Invoke-RestMethod -Method Post http://localhost:4000/api/logix-designer-sdk/download
```

This returns HTTP 405 by design.

## Rockwell Documentation Basis

Rockwell's March 2026 Logix Designer SDK guide describes:

- Python and C# SDK clients;
- Python setup under the SDK `python\Examples` folder;
- C# setup with `RockwellAutomation.LogixDesigner.CSClient`;
- open/save/export to `ACD`, `L5K`, and `L5X`;
- component import/export;
- project conversion to installed Logix Designer major revisions;
- controller download APIs.

ESCO uses the safe review and sandbox operations above and keeps controller
transfer APIs blocked.

Reference: https://literature.rockwellautomation.com/idc/groups/literature/documents/gr/ldsdk-gr001_-en-p.pdf
