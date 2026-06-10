# ESCO-native file formats

ESCO Automation Studio owns a family of native file formats. They are open,
inspectable ESCO-defined JSON artifacts. They do not depend on, copy, or mirror
proprietary `.ACD` binary project files, and they are not hardware-online
workflows.

The code registry lives in `@esco/project-actions` as `ESCO_FILE_FORMATS`.

| Extension     | Name                           | Purpose                                      | Status              |
| ------------- | ------------------------------ | -------------------------------------------- | ------------------- |
| `.easproj`    | ESCO Automation Studio Project | Editable ESCO project of record              | Implemented         |
| `.easctrl`    | ESCO Controller                | Offline controller definition                | Schema-registered   |
| `.eastags`    | ESCO Tag Set                   | Controller/program tag set                   | Schema-registered   |
| `.easroutine` | ESCO Routine                   | Single routine source and metadata           | Schema-registered   |
| `.easio`      | ESCO I/O Configuration         | Offline I/O module tree and connection data  | Schema-registered   |
| `.eashmi`     | ESCO HMI Application           | HMI screens, bindings, navigation, assets    | Schema-registered   |
| `.easlib`     | ESCO Automation Library        | Reusable routines, data types, HMI assets    | Implemented         |
| `.eassnap`    | ESCO Project Snapshot          | Restorable offline project/HMI state         | Implemented         |
| `.easx`       | ESCO Exchange                  | Portable editable project exchange           | Implemented         |
| `.easruntime` | ESCO Automation Studio Runtime | Compiled offline runtime artifact            | Implemented         |
| `.easpkg`     | ESCO Automation Package        | Deterministic embedded artifact package      | Implemented         |

Compatibility aliases:

- `.plcproj.json` still opens as an ESCO project file for existing workspaces.
- `.easrt` is accepted on runtime import for older ESCO Runtime exports, but new
  runtime exports use `.easruntime`.

## Common envelope

Schema-registered native artifacts use a deterministic JSON envelope:

```jsonc
{
  "formatName": "ESCO Routine",
  "extension": ".easroutine",
  "schemaVersion": 1,
  "native": {
    "kind": "routine",
    "producedBy": "ESCO Automation Studio",
    "createdAt": "<ISO timestamp>",
    "checksum": { "algorithm": "sha256", "value": "<64-hex sha256 of payload>" }
  },
  "payload": { /* ESCO-authored JSON payload */ }
}
```

Serialization is canonicalized with sorted object keys, preserved array order,
and a checksum over the canonical payload JSON. Validators reject malformed JSON,
unknown extensions, future schema versions, wrong format kinds, checksum
mismatches, and `.ACD`/`.L5X` paths when an ESCO-native file is expected.

## `.easproj`

`.easproj` is the first-class editable ESCO project extension. It uses the same
self-describing project JSON that the app already opens as `.plcproj.json`, so
existing projects remain loadable while new ESCO-branded project paths can be
treated as native project files.

L5X remains an offline interchange format for import/export review. It is not
the ESCO project file of record. `.ACD` remains unsupported proprietary binary
input/output and is blocked by the format guard.

## `.easruntime`

`.easruntime` is the compiled ESCO Runtime artifact. It is an execution-oriented
snapshot of an ESCO project, not an editable project save clone.

Implemented behavior:

- Build compiles the ESCO project model into ordered tasks, programs, routines,
  runtime tag metadata, initial values, I/O metadata, and build warnings.
- Export writes a checksummed `.easruntime` JSON envelope using deterministic
  serialization.
- Import validates the extension, schema, checksum, and ESCO-native provenance,
  then reconstructs an inspectable read-only project skeleton. Provenance is
  stamped as `sourceType: "esco-runtime"`.

`.easruntime` does not claim native `.ACD` support, controller download support,
or hardware-online behavior.

## `.easpkg`

`.easpkg` is a deterministic JSON package for ESCO-native artifacts. It keeps
the manifest at the top level for compatibility, then adds embedded artifact
texts plus a package-level checksum over the manifest and embedded content.

Implemented behavior:

- Export writes the editable `.easproj` project and compiled `.easruntime`
  artifact into a single self-contained package.
- Validation checks sorted paths, duplicate paths, ESCO-only extensions, entry
  byte counts, per-entry SHA-256 checksums, and the package-level checksum.
- Import extracts the embedded editable ESCO project entry and opens it through
  the normal project loader.
- Manifest-only `.easpkg` files still validate for compatibility, but they
  cannot be extracted because they do not carry artifact contents.

`.easpkg` remains an offline file workflow. It is not a ZIP installer, not a
controller download, and not a proprietary binary project container. `.ACD` and
`.L5X` entries are rejected from ESCO-native packages.

## `.easx`

`.easx` is a portable ESCO Exchange file for moving an editable project between
offline Studio workspaces. It is a checksum-protected native envelope that
embeds one editable `.easproj` project artifact plus a summary of controller,
program, routine, tag, and I/O counts.

Implemented behavior:

- Export writes a single embedded `.easproj` artifact and records byte counts,
  media type, project summary, and explicit offline boundaries.
- Validation treats `.easx` as a native ESCO envelope and verifies the payload
  checksum without changing the active project.
- Import validates the exchange envelope, checks the embedded project byte
  count, then opens the `.easproj` content through the normal ESCO project
  loader.

`.easx` is not a runtime package, not a controller upload/download route, not an
online-edit workflow, and not a proprietary binary project file.
