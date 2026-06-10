# ESCO HMI Authoring Gap Notes (Historical Intake)

Source: `C:\Users\nmodha\Downloads\Designer.pdf`

PDF identified as a vendor HMI design manual. This note is historical intake only.

## Important Boundary

This file must not be used to copy vendor UI, text, workflows, binaries, or runtime
behavior. Convert any retained ideas into ESCO-authored requirements before
implementation.

For ESCO Automation Studio, this file only marks broad HMI coverage areas such as
workstation shell, screen authoring, runtime preview, alarms, trends, data logs,
security, devices, and project workflow. It does not define controller-side ladder,
ST, FBD, SFC, online edits, motion, safety, or instruction execution semantics.

To reach ESCO-native coverage, ESCO needs:

- ESCO-authored controller programming requirements from public, licensed, and
  internally-created sources only.
- ESCO-authored HMI requirements that avoid vendor UI/text copying.
- A safe AI layer that can understand both controller logic and HMI design, but only mutates projects through reviewed project actions.

## Source Page Map

- Pages 25-28: Studio 5000 environment, help, additional resources.
- Pages 29-52: View Designer overview, planning, HMI concepts, migration terminology.
- Pages 53-66: Project creation, open/save/close, conversion, runtime save, content reuse.
- Pages 67-84: HMI device selection, project properties, language, usage/capacity, screen scaling.
- Pages 85-94: Controller references, synchronization, tag browsing, controller state indicators.
- Pages 95-100: Default project content, Project Explorer, predefined screens.
- Pages 101-108: Shortcuts.
- Pages 109-120: Popups.
- Pages 121-130: System Banner.
- Pages 131-346: Graphic elements, toolbox, graphic explorer, images, PDFs, grouped graphics.
- Pages 347-356: Screens.
- Pages 357-358: Undo and redo.
- Pages 359-434: Reuse, user-defined properties, Add-On Graphics, reusable content.
- Pages 435-446: Animations.
- Pages 447-488: Events and commands.
- Pages 489-492: HMI Button Control.
- Pages 493-546: Properties, bindings, expression editor, system tags, verification.
- Pages 547-550: Find and replace.
- Pages 551-562: Project navigation.
- Pages 563-614: Alarms.
- Pages 615-632: Automatic Diagnostics.
- Pages 633-648: Trend charts.
- Pages 649-668: Data logs.
- Pages 669-676: Language switching.
- Pages 677-684: Emulator.
- Pages 685-708: Security.
- Pages 709-726: Download/upload, verify, runtime save.
- Pages 727-728: Import/export.
- Pages 729-828: Runtime application.
- Pages 829-842: Troubleshooting.
- Pages 843-845: Glossary.

## Parity Domains Extracted From The PDF

### 1. Studio Environment And Product Shell

ESCO needs a product shell that supports a project-centered workstation, not only a ladder editor. From the View Designer side, the shell must include:

- Studio launcher style entry into project creation/opening.
- Project file lifecycle commands: create, open, rename, save, save as/copy, close, convert, import, export.
- Help/discovery system with topic-aware help and contextual troubleshooting.
- Planning-oriented startup flow for selecting project type, target device, controller references, screen hierarchy, naming conventions, and reusable content strategy.
- Clear safety language distinguishing design-time, offline simulation, emulation, runtime packaging, and real device operations.

ESCO implication:

- Keep the current IDE shell for localhost.
- Desktop `.exe` startup should open the branded startup dialog, then enter the IDE.
- Add a first-run setup wizard for user login and AI provider/API-key setup, storing credentials outside the project.
- Project templates should include controller-only, HMI-only, and controller-plus-HMI modes.

### 2. Project Lifecycle

View Designer expects a full project workflow:

- New Project dialog.
- Open Project dialog.
- Rename project and project file.
- Sort Project Explorer content.
- Save project.
- Save project copy.
- Save runtime application to removable media.
- Close project.
- Convert project across versions or target formats.
- Import/export project content.

ESCO requirements:

- Add real file-backed desktop persistence, not browser-session-only persistence.
- Add recent projects.
- Add Save As.
- Add project properties with version, author/company metadata, target families, default language, AI profile pointer, and compatibility level.
- Add migration/versioning metadata and upgrade reports.
- Treat runtime/export bundles as separate artifacts from editable ESCO project files.

AI integration:

- AI can summarize project metadata and migration risk.
- AI can propose project cleanup, naming normalization, missing metadata, and reusable structure.
- AI must never silently convert or overwrite a project. All file operations remain explicit user actions.

### 3. HMI Device Selection And Screen Scaling

View Designer includes a target device model:

- Select a target HMI device for new project.
- Browse for HMI device.
- Project Properties dialog with Application, Language, Usage and Capacity tabs.
- Select default device language.
- Change target HMI device.
- Choose screen scaling behavior.
- Remove device from network tree.
- Device dimensions and DPI affect screen/content measurements.
- Raster images can become unclear when scaled.

ESCO requirements:

- Add HMI device profile registry.
- Track display size, DPI, supported features, family, firmware level, scaling behavior, memory/capacity limits, supported runtime features, and unsupported tags/features.
- Add usage/capacity panel.
- Add screen scaling preview and warnings.
- Add target-device compatibility verification.

AI integration:

- AI can recommend device profile based on screen count, asset sizes, trend/log needs, security, and expected operator workflows.
- AI can flag scaling risks and oversized images/assets.

### 4. Controller References And Synchronization

ESCO HMI projects need controller references and synchronized data:

- Add/copy/remove controller references.
- Browse controller reference.
- Remove controller from network tree.
- Synchronize tags, data types, program tags, and alarms between ESCO controller
  projects and ESCO HMI screens.
- Show controller reference state icons: synchronizing, not synchronized, error, synchronized.
- Support tag browsing, including secured project file behavior.
- Runtime application also checks controller/project consistency.

ESCO requirements:

- Add a `ControllerReference` model that can point to imported L5X/project metadata.
- Keep this offline until real controller support is explicitly implemented.
- Add synchronization status as offline metadata: not imported, stale, synchronized, conflict, unsupported source.
- Add tag/data-type/alarm browser across controller references.
- Add secured-reference placeholder behavior that does not bypass passwords or decrypt `.ACD`.

AI integration:

- AI can explain stale references, missing tags, type mismatches, unbound HMI elements, and import conflicts.
- AI can propose remapping tags or creating placeholder tags through project actions.
- AI cannot claim live controller sync unless real controller communication is implemented.

### 5. Default Project Content And Project Explorer

View Designer projects include default content:

- Project Explorer.
- Predefined Screens folder.
- System Banner.
- Settings screen.
- Alarm Summary.
- Alarm Manager.

ESCO requirements:

- Expand Project Explorer beyond controller ladder items:
  - Controllers
  - Controller Tags
  - Tasks
  - Programs
  - Routines
  - HMI Devices
  - Screens
  - Popups
  - Shortcuts
  - System Banner
  - Alarms
  - Trends
  - Data Logs
  - Security
  - Images
  - PDFs
  - Add-On Graphics
  - Libraries
  - Reports/Compare
- Add predefined screens as real templates, not demos.
- Allow project explorer folders and custom organization.

AI integration:

- AI can generate an operator-screen hierarchy from controller tags and process descriptions.
- AI can suggest missing predefined screens based on alarms, trends, and data logs.

### 6. Shortcuts

View Designer supports shortcuts:

- Create shortcut to existing screen.
- Create shortcut to new screen.
- Open, rename, copy, close, delete shortcut.
- Open defining screen.
- Customize shortcut.

ESCO requirements:

- Add `Shortcut` entities linked to screens/popups/folders.
- Add navigation behavior and access restrictions.
- Add icon/caption selection.
- Add shortcut copy/paste and validation for broken targets.

AI integration:

- AI can propose navigation menus and shortcuts from screen hierarchy.

### 7. Popups

View Designer supports popups:

- Create/open/copy/rename/delete/close popup.
- Change caption.
- Remove caption.
- Remove close button.
- Set background color and opacity.
- Resize.
- Add popups to cache.
- Change update rate.
- Restore predefined popup content.

ESCO requirements:

- Add popup designer with screen-like canvas.
- Support popup properties: caption, close button, size, background, opacity, cache policy, update rate.
- Validate popup target references and event calls.

AI integration:

- AI can propose alarm details, motor controls, diagnostic, confirmation, and parameter-entry popups.

### 8. System Banner

View Designer includes a shared system banner:

- Open System Banner.
- Change height and background color.
- Add/copy/remove graphic elements.
- Remove System Banner from a screen.
- Close System Banner.
- Restore default content.
- Change update rate.
- Display system/banner content such as status indicators.

ESCO requirements:

- Add `SystemBanner` as a shared HMI surface.
- Allow per-screen show/hide.
- Include status indicators for controller reference, offline simulation, alarm state, diagnostics, user/security, date/time, and runtime status.

AI integration:

- AI can recommend useful status indicators and bind them to system tags.

### 9. Visual Screen Designer And Graphic Editing

The PDF's largest area is the graphic designer. ESCO needs a canvas-based HMI editor with:

- Toolbox.
- Graphic Explorer.
- Lock/unlock graphic elements.
- Drawing tools: rectangle, square, line, polyline, polygon, oval, circle, arc.
- Add graphic elements, Add-On Graphics, and images.
- Select from canvas or Graphic Explorer.
- Copy/delete elements.
- Change properties and text.
- Set text/fill color.
- Move, rotate, flip, resize.
- Align, distribute, duplicate.
- Smart guides.
- Stacking order.
- Group/ungroup and nested group operations.
- Zoom.
- Slider support.

ESCO requirements:

- Add a HMI screen canvas distinct from ladder editor.
- Add inspector/properties panel.
- Add selection model, handles, alignment guides, grouping, layers, z-order, snapping, zoom, and keyboard shortcuts.
- Persist every graphic as structured JSON, not pixels.
- Verify no text clipping and no invalid bindings.

AI integration:

- AI can generate screen layouts from process intent, but only as previewed project actions.
- AI can suggest visual fixes for alignment, readability, color contrast, and operator workflow.

### 10. Graphic Element Library

View Designer's toolbox/library categories include:

- Alarms: Alarm Manager, Alarm Summary, Alarm History, icons.
- Automatic Diagnostics: live and history table variants.
- Buttons and switches: 22mm, 30mm, legend plates.
- Common Controls: Button, DateTime Display, Image, Numeric Display, Numeric Input, PDF element, horizontal/vertical sliders, Text Display, Text Input.
- Flags.
- General Equipment: cabinets, computers, conveyors, fans, feeders, fixtures, gauges, indicators, instrumentation, laboratory, miscellaneous, motors, pallets, pipes, pumps, sensors, separators, spools, tanks/containers, textures, tick marks, valves.
- Graph: trend charts.
- Security: log on and log off buttons.
- Signs and Symbols: electrical symbols, flowcharts, fluid power, icons, indicators, ISO hazard signs/symbols, mandatory signs/symbols, sign templates, ISA symbols.
- System: activity indicator, alarm status indicator, checkbox, controller status indicator, error, list box indicator, list box selector, navigation menu, network status indicator, project events status indicator, radio button, success.
- Trend charts.

ESCO requirements:

- Create a real HMI element registry, parallel to the ladder instruction registry.
- Each element needs:
  - Type id.
  - Display name.
  - Category.
  - Default geometry.
  - Properties schema.
  - Bindable properties.
  - Event support.
  - Runtime behavior.
  - Design-time renderer.
  - Validation rules.
- Add read-only/import-preserved unknown elements.
- Add a searchable toolbox with categories and favorites.

AI integration:

- AI can choose elements from the registry only.
- AI cannot invent unknown element types unless they are preserved as unknown/read-only.

### 11. Images And PDF Documents

View Designer manages project assets:

- Add, copy, preview, rename, delete, replace images.
- Replace image throughout project.
- Image naming conventions.
- Add PDF document to project.
- Rename/replace/copy/delete PDF.
- Add PDF to screen, popup, or Add-On Graphic.
- Add PDF viewer Add-On Graphic.
- Bind PDF bookmark properties.
- Add event commands to interact with PDF elements.

ESCO requirements:

- Add asset manager for images and PDFs.
- Add asset deduplication/hash tracking.
- Add usage references and replace-all operations.
- Add PDF viewer element in design/runtime preview.
- Add validation for missing/unsupported assets.

AI integration:

- AI can find unused assets, oversized images, duplicated assets, missing references, and propose cleanup.

### 12. Screens

View Designer screen workflows:

- Screen tab.
- Create/open/copy/rename/delete/close/close all screens.
- Change background color.
- Restore predefined content.
- Restrict access to an item.
- Change update rate.

ESCO requirements:

- Add screen tabs alongside ladder routine tabs.
- Add screen properties.
- Add per-screen security, update rate, navigation metadata, and target-device compatibility.
- Add screen copy/paste and template creation.

AI integration:

- AI can create screen skeletons and suggest HMI workflows.

### 13. Undo And Redo

View Designer supports undo/redo for project actions.

ESCO requirements:

- Extend existing undo/redo from ladder edits to all HMI edits, asset edits, security edits, data log edits, trend edits, and event edits.
- Group compound generated AI plans into one undoable transaction.

### 14. Reuse, User-Defined Properties, And Add-On Graphics

View Designer's reusable content model includes:

- Reusable screens and popups.
- Alias properties.
- User-defined properties with data types.
- Property propagation.
- Link/unlink user-defined properties to base properties.
- Data Type Browser and Logix data type support.
- Add-On Graphics definitions and instances.
- Vendor and revision metadata.
- Add-On Graphic user-defined data type properties.
- Copy definitions within and between projects.
- Reuse images and user-defined properties between projects.
- Predefined Add-On Graphics.
- Event support on Add-On Graphics.
- Animation using color/state tables.
- Property-to-property binding inside Add-On Graphics.
- User-defined data type binding.
- Controller tag restrictions and validation for reusable graphics.

ESCO requirements:

- Add `AddOnGraphicDefinition` and `AddOnGraphicInstance`.
- Add user-defined property system.
- Add alias property system.
- Add type browser integrated with controller data types.
- Add reusable content import/export.
- Add propagation engine for changes to definitions.
- Add validation for illegal direct bindings inside reusable definitions.

AI integration:

- AI can convert repeated screen content into reusable Add-On Graphics.
- AI can propose property interfaces for reusable graphics.
- AI can generate binding maps for instances.

### 15. Animations

View Designer supports:

- Animations tab.
- Color Table Definition.
- State Table Definition.
- Configure/change/delete color-table and state-table animation.
- Property binding based animation.
- Animation types and configuration methods.
- Animations and groups.
- Expression values in color/state tables.
- Output value calculation.
- Numeric conversion behavior and fuzzy comparison.

ESCO requirements:

- Add animation model:
  - Target property.
  - Source expression/binding.
  - Color table.
  - State table.
  - Property binding.
  - Group behavior.
  - Evaluation order.
- Add animation preview/simulation.
- Add validation for unreachable states, invalid expressions, invalid target properties, and type conversion risk.

AI integration:

- AI can explain why an animation does not change state.
- AI can generate state/color tables for common equipment states.

### 16. Events And Commands

View Designer supports events on elements, screens, groups, and projects:

- Button behavior events.
- Key press and key release.
- Touch press and touch release.
- State enter and state exit.
- Project events.
- Multiple events and precedence/order rules.

Commands include:

- Navigate on HMI.
- Calibrate touch screen.
- Change language.
- Change graphic element state.
- Change tag value.
- Interact with PDF element.
- Load runtime application.
- Send email.
- Log on or log off.
- Reboot HMI.
- Safely remove media.
- Export data log.
- Clear data logs.
- Open or close web browser.
- Import or delete certificate.

ESCO requirements:

- Add event model:
  - Source object.
  - Event type.
  - Ordered command list.
  - Conditions if supported.
  - Permissions.
  - Runtime safety classification.
- Add command registry.
- Add design-time validation and runtime simulation for safe commands.
- Mark hardware/device commands model-only until real runtime support exists.
- Preserve unknown commands as read-only.

AI integration:

- AI can generate event-command flows from operator intent.
- AI must classify risky commands and require review.
- AI cannot execute device/hardware commands from the editor.

### 17. HMI Button Control

View Designer includes HMI Button Control:

- High-speed HMIBC button.
- Visual feedback.
- Tag existence validation.

ESCO requirements:

- Add model-only HMIBC support.
- Add validation for missing HMIBC tags.
- Do not imply deterministic high-speed hardware behavior unless a supported runtime/device exists.

AI integration:

- AI can explain HMIBC configuration and missing tag errors.

### 18. Properties, Bindings, Expressions, And System Tags

View Designer has a rich property and expression system:

- Properties window and tab.
- List of properties.
- Color picker and custom gradients.
- Text/fill color selection.
- Bind color property to tag or expression.
- Bind properties to data items.
- Property-to-property binding.
- Binding removal.
- Extended properties of tags.
- Expression editor.
- Expression syntax validation.
- Conditional expressions.
- Expression evaluation rules.
- Supported expression components.
- Numeric tag conversion behavior.
- System tags for alarms, auto-logoff, controller, data logs, date/time, device, display, Ethernet, project events, security, SMTP, VNC.
- Verify controller tags.
- Verify Project dialog.
- Errors window.

ESCO requirements:

- Add expression AST/parser/evaluator outside React.
- Add bindable-property schema.
- Add type checker for tag/property/expression bindings.
- Add system tag registry.
- Add tag extended-properties model.
- Add expression editor with diagnostics and autocomplete.
- Add circular binding detection.
- Add controller tag verification.

AI integration:

- AI can explain expressions, detect circular or risky bindings, suggest fixes, and generate expressions from natural language.
- AI can use tag descriptions and extended properties as context.

### 19. Find And Replace

View Designer supports:

- Find text in project.
- Find and replace text.
- Find Results window.

ESCO requirements:

- Global search across ladder, tags, comments, HMI screens, bindings, expressions, events, alarms, data logs, security names, assets, and reusable definitions.
- Safe replace with preview.
- Scope filters.

AI integration:

- AI can explain impact of a proposed rename/replace before applying.

### 20. Project Navigation

View Designer supports:

- Navigation menu.
- Side and bottom navigation menu contents.
- Home screen.
- Shortcut icons.
- Omitting items from navigation.
- Moving Project Explorer items.
- Folders and captions.
- Security restrictions.

ESCO requirements:

- Add navigation designer.
- Add route model for runtime screen navigation.
- Add folder hierarchy and captions.
- Add security-aware visibility.

AI integration:

- AI can optimize navigation flow and detect dead-end screens.

### 21. Alarms

View Designer alarm support includes:

- Alarm overview.
- Alarm faults and alarm quality.
- Alarm Summary, Alarm Manager, Alarm History.
- Alarm table row readability/touch settings.
- Opacity, visibility, default sort.
- Add/delete/reorder/resize columns.
- Disable buttons.
- Restrict operations by access.
- Table columns.
- Details panes.
- Help popups.
- Filters and default filters.
- Quality indicators and fault resolution.

ESCO requirements:

- Add alarm model integrated with imported Logix alarm metadata.
- Add alarm table elements with configurable columns, sorting, filters, details pane, help popup, access restrictions, button enablement, and history variants.
- Add alarm quality/state model for simulation.
- Add alarm verification diagnostics.

AI integration:

- AI can diagnose why an alarm is missing, bad quality, not visible, or not actionable.
- AI can generate alarm screens and default filters.

### 22. Automatic Diagnostics

View Designer includes automatic diagnostic tables:

- Automatic Diagnostics and Automatic Diagnostics History.
- Row readability/touch settings.
- Opacity, visibility, default sort.
- Column add/resize/reorder/delete.
- Statuses.
- Details panes.
- Access restrictions.
- Help popup.
- Filtering and default filter.

ESCO requirements:

- Add diagnostics event/data model.
- Add diagnostics table elements.
- Add simulated diagnostics from validator, import warnings, runtime model, and hardware metadata.
- Mark hardware-sourced automatic diagnostics model-only until real hardware support exists.

AI integration:

- AI can explain diagnostics and propose fixes.

### 23. Trend Charts

View Designer trend chart support includes:

- Traces tab.
- Basic trend chart creation.
- Add/delete traces.
- Bind trace to tag, user-defined property, or graphic property.
- Trace labels.
- Time range.
- Pan to start time via property binding or event.
- Visibility.
- Controller request rate.
- Trend contents.
- Appearance settings: border, background, grid, text, axes, trace color/marker, date display, interaction lockout.
- Runtime view/pan/pause.

ESCO requirements:

- Add trend chart model and runtime buffer.
- Add trace binding system.
- Add time-range controls, pan/pause, styling, and sampling behavior.
- Add validation for invalid trace bindings and unsupported data types.

AI integration:

- AI can recommend trends for important process variables.
- AI can explain missing or flat trend data.

### 24. Data Logs

View Designer data logs include:

- Add/open/rename/delete data log.
- Sample rate.
- Log duration.
- Add/delete tags.
- Add status tag.
- Reuse tags between logs.
- Event command to export data log.
- Event command to clear data logs.
- Data log tab and contents.
- Maximum configuration size calculation.
- Data retention.
- Runtime export to removable media.

ESCO requirements:

- Add data log configuration model.
- Add local simulation/runtime buffer.
- Add export format.
- Add size/capacity estimator.
- Add retention rules.
- Add status-tag behavior.
- Add validation for invalid tags and unsupported storage targets.

AI integration:

- AI can propose data logs for troubleshooting or compliance.
- AI can summarize logged data and identify outliers when data is available.

### 25. Languages And Localization

View Designer supports:

- Export text strings for translation.
- Import language files.
- Add/remove project languages.
- Change language through event command.
- Default project/device language.
- STRING support behavior.

ESCO requirements:

- Add string table extraction from screens, popups, banners, alarms, help text, and commands.
- Add import/export language files.
- Add runtime language switch model.
- Add missing translation diagnostics.

AI integration:

- AI can identify untranslated strings and help draft translations, with review.

### 26. Emulation

View Designer includes an emulator:

- Start/close emulator.
- Emulator scaling for target device.
- Unsupported tags.
- Emulator window and dialog.

ESCO requirements:

- Add HMI runtime preview/emulator inside desktop app.
- Simulate bindings, events, navigation, animations, alarms, trends, and logs using offline tag memory.
- Show unsupported/runtime-only features clearly.

AI integration:

- AI can analyze emulator errors and suggest fixes.

### 27. Security

View Designer security includes:

- Security Administration dialog.
- Log On Method, Policies, Users tabs.
- Password policies.
- Auto-logoff.
- User account add/copy/delete/change/sort.
- Guest user role.
- Security roles.
- Restrict settings, items, graphic elements, HMI device, screens, shortcuts, popups.
- VNC access rights.
- Allowed locations list.
- Open ports list.
- Network-based security using Active Directory.
- Runtime credential caching behavior.

ESCO requirements:

- Add security model with users, roles, permissions, guest, policies, auto-logoff, screen/element restrictions.
- Add desktop-login setup and provider configuration separate from project security.
- Add network/AD model-only placeholders unless enterprise auth is implemented.
- Add VNC/browser/port settings as runtime-device configuration, model-only until real target runtime exists.
- Do not store secrets in project files.

AI integration:

- AI can audit access restrictions and highlight insecure or inconsistent project security.
- AI must not reveal or handle stored API keys except through secure configuration APIs.

### 28. Verify, Runtime Save, Download, And Upload

View Designer includes:

- Download runtime application to HMI.
- Download to a different HMI device.
- Save runtime application to removable media.
- Runtime scaling on different devices.
- Errors window and sorting.
- Verify project.
- Verify Project dialog.
- Upload and save runtime application from HMI.
- Load runtime application event.
- Safe remove media event.
- Exit application.

ESCO requirements:

- Add HMI project verification.
- Add runtime package build/save.
- Add upload/download UI as disabled/model-only until real device support exists.
- Add artifact signing/checksum/version metadata.
- Add errors window that includes HMI diagnostics alongside ladder diagnostics.
- Never fake a real device transfer.

AI integration:

- AI can explain verification failures and package-build issues.
- AI cannot download/upload to hardware unless explicit future hardware support and permissions exist.

### 29. Import And Export

View Designer supports importing content into a project and exporting a project.

ESCO requirements:

- Add HMI content import/export.
- Preserve unknown content read-only.
- Export project and runtime bundles separately.
- Add round-trip tests for all supported HMI models.

AI integration:

- AI can summarize import/export changes and unresolved unsupported content.

### 30. Runtime Application

View Designer runtime includes:

- Runtime application components.
- Configure HMI device.
- Perform basic runtime functions.
- Interact with alarms.
- View trend charts.
- Log data.

ESCO requirements:

- Add runtime mode separate from design mode.
- Runtime mode should support navigation, screen rendering, popups, banner, bindings, animations, events, alarms, trends, logs, security, and language switching.
- Runtime mode starts offline by default.
- Device configuration should be separate from controller communication.

AI integration:

- AI can observe runtime/simulation state and explain behavior, but cannot perform hidden runtime operations.

### 31. Troubleshooting Knowledge Base

The PDF includes troubleshooting categories:

- Add-On Graphics paste/delete/state issues.
- Alarm visibility, quality, manager/summary/history issues.
- Data log export/status/tag issues.
- Graphic element selection/outline issues.
- HMI device issues.
- Navigation speed or missing menu items.
- Security and network-based security errors.
- Tag values and HMIBC missing tags.
- Upload/download connection and project-file issues.

ESCO requirements:

- Convert troubleshooting categories into validator rules, diagnostics, and AI knowledge cards.
- Add "Why is this broken?" flows in AI Copilot and diagnostics.
- Link diagnostics to exact project object and proposed action.

AI integration:

- AI should map symptoms to likely causes and safe fixes.
- AI should produce project actions only when fixes are deterministic and reviewable.

## Data Model Additions Needed For ESCO

Add these model families without replacing the existing semantic ladder AST:

- `HmiProject`: device target, default language, runtime settings, screen hierarchy.
- `HmiDeviceProfile`: family, size, DPI, firmware, capacity, supported features.
- `ControllerReference`: imported controller metadata, source file, sync state, tag/type/alarm cache.
- `Screen`: canvas size, background, update rate, security, elements, navigation metadata.
- `Popup`: caption, close button, size, cache policy, update rate, elements.
- `SystemBanner`: shared canvas, height, background, update rate.
- `Shortcut`: target screen/popup, caption, icon, folder, security.
- `GraphicElement`: registry type, geometry, style, properties, bindings, events.
- `GraphicGroup`: grouped elements, locked state, transform, events.
- `AddOnGraphicDefinition`: reusable definition, vendor, revision, property interface, elements.
- `AddOnGraphicInstance`: definition id, instance properties, bindings.
- `Asset`: image/PDF, metadata, hash, references.
- `PropertyBinding`: target object/property, source tag/property/expression, data type.
- `ExpressionAst`: parsed expression, dependencies, diagnostics.
- `Animation`: target property, color/state table, binding/expression, evaluation rules.
- `EventHandler`: event source, event type, ordered command list.
- `Command`: command type, arguments, runtime safety classification.
- `AlarmView`: table type, columns, filters, sorting, operations, access rights.
- `AutomaticDiagnosticsView`: columns, filters, sorting, detail panes.
- `TrendChart`: traces, time range, sampling/request rate, visual style.
- `DataLog`: tags, status tag, sample rate, retention, capacity estimate.
- `LanguagePack`: language id, strings, import/export metadata, missing string findings.
- `SecurityPolicy`: users, roles, password policies, auto-logoff, restrictions.
- `RuntimePackage`: built artifact metadata, target profile, checksum, verification summary.
- `VerificationFinding`: domain, severity, source object path, message, fix suggestions.

## UI Surfaces Needed

- Startup dialog: login, continue offline, open project, new project, import L5X, restore backup.
- Main IDE shell: top app bar, ribbon, project explorer, center workspace, properties/AI panel, bottom dock, status bar.
- Project Explorer tabs:
  - Controllers
  - HMI
  - Assets
  - Library
  - Security
  - Reports
- Editors:
  - Ladder editor
  - ST/FBD/SFC read-only viewers, then editors later
  - HMI screen canvas
  - Popup editor
  - System Banner editor
  - Add-On Graphic definition editor
  - Tag table
  - Alarm table designer
  - Trend/data log designer
  - Security administration
  - Project properties
  - Runtime/emulator preview
- Bottom dock:
  - Diagnostics
  - Search Results
  - References
  - Build/Verify
  - Watch
  - Trend
  - Trace
  - Forces
  - AI Review

## AI Integration Requirements

### Provider And Credential Model

- First-run setup lets the user choose OpenAI or Anthropic/Claude.
- API key is stored securely at workstation level, not in project JSON.
- The Copilot panel displays the selected provider/model from saved setup.
- The Copilot panel does not show API key fields or transport controls.
- Local/offline fallback remains available.

### Safe Agent Contract

- AI can read project model, validation findings, selected object, tags, routines, HMI screens, bindings, events, alarms, trends, logs, and runtime simulation state.
- AI write operations become proposed project-action plans.
- User must review and click Apply.
- Apply routes through `packages/project-actions`.
- Validation runs after apply.
- One AI plan equals one undoable transaction.
- AI cannot directly write files, mutate React state, call PLC communication, download/upload, or edit `.ACD`.

### AI Tool Families

Read tools:

- Inspect project summary.
- Inspect routine/rung/tag.
- Inspect HMI screen/popup/banner.
- Inspect selected graphic element.
- Inspect bindings/expressions/events.
- Inspect alarm/trend/log/security configuration.
- Run validation.
- Run offline simulation/emulation.
- Get cross references.
- Compare projects.

Write proposal tools:

- Create/update tags.
- Add/modify ladder rungs through existing action layer.
- Create HMI screen/popup/banner.
- Add/update graphic element.
- Add binding/expression.
- Add animation.
- Add event command.
- Add alarm/trend/data log.
- Add language string.
- Add security role/restriction.
- Create reusable Add-On Graphic.
- Fix invalid references when deterministic.

### AI Product Features

- Explain selected rung/routine/screen/binding/event/alarm/trend/log.
- Diagnose validation findings.
- Generate safe starter logic and matching HMI screens.
- Generate a motor/valve/pump faceplate as an Add-On Graphic.
- Generate alarm summary/manager/history screens.
- Generate trend and data logging setup for selected tags.
- Suggest security restrictions.
- Explain why an HMI action does not happen in runtime preview.
- Convert repeated screen content into reusable Add-On Graphics.
- Summarize project risk before export/runtime package build.
- Produce a migration report after importing older/foreign projects.

## Non-Negotiable Safety Rules

- Do not fake "Connected" state.
- Default status remains Offline Simulation.
- Real controller communication is a separate, explicit future capability.
- Online edits, upload, download, and go-online behavior must not be simulated as real.
- `.ACD` files are never edited.
- Unsupported imported content is preserved read-only.
- Parser/simulator/validator logic remains outside React.
- Semantic ladder AST remains source of truth for ladder.
- Instruction registry remains source of truth for ladder instruction metadata.
- HMI element registry should become source of truth for HMI element metadata.
- AI can propose, not directly mutate.
- All project mutations go through `packages/project-actions`.

## Implementation Phases Toward Parity

### Phase A: HMI Model Foundation

- Add HMI project data model.
- Add device profile registry.
- Add screen, popup, banner, shortcut, asset, binding, event, security, trend, data log schemas.
- Add verification rules for empty/invalid HMI objects.
- Add import/export for ESCO project JSON.

### Phase B: HMI Designer UI

- Add HMI Project Explorer nodes.
- Add screen canvas editor.
- Add toolbox/element registry.
- Add properties panel and graphic explorer.
- Add selection, geometry editing, z-order, grouping, align/distribute, lock/unlock.
- Add images/PDF asset manager.

### Phase C: Bindings, Expressions, Animations, Events

- Add expression parser/evaluator/type checker outside React.
- Add bindable property schemas and autocomplete.
- Add color/state table animations.
- Add event-command registry and editor.
- Add runtime-safe command simulation.

### Phase D: Alarms, Diagnostics, Trends, Logs

- Add alarm views, history views, filters, columns, access controls.
- Add automatic diagnostics model/table.
- Add trend buffer and chart editor.
- Add data log model, retention, export, status tags.

### Phase E: Security, Languages, Runtime Preview

- Add security admin model/UI.
- Add language pack export/import.
- Add runtime/emulator mode.
- Add runtime navigation, popups, banner, bindings, animations, events, alarms, trends, logs.

### Phase F: Runtime Packaging And Import/Export Depth

- Add verify/build runtime package.
- Add offline save-to-media artifact.
- Add import/export for HMI content.
- Add migration/versioning reports.
- Keep upload/download disabled/model-only until real hardware support exists.

### Phase G: AI Deep Integration

- Add provider setup and secure key storage.
- Add project-aware toolcalling agent.
- Add HMI action proposals.
- Add AI diagnosis over validation, simulation, and runtime preview.
- Add AI-generated screens/faceplates/trends/logs/security plans.
- Add tests proving AI cannot bypass project-actions.

### Phase H: Real Hardware Support, Only After Safety Design

- Add communication architecture, permissions, audit logs, and device sandboxing.
- Add read-only browsing first.
- Add explicit online state.
- Add upload/download only after verification, rollback, and operator confirmations.
- Add online edits only after a formal safety gate.

## Acceptance Criteria For "1 To 1" Against This PDF

ESCO can be considered View Designer parity-ready when:

- Every chapter workflow in the page map has a corresponding ESCO UI workflow, model, validation rule, and test.
- Every graphic element category has registry coverage or an explicit read-only unsupported preservation path.
- Screens/popups/banner/shortcuts/navigation can be designed, saved, reopened, copied, and verified.
- Bindings, expressions, animations, events, alarms, trends, data logs, languages, security, and runtime preview are modeled structurally.
- Import/export round trips preserve supported content and safely preserve unsupported content.
- Runtime package build and verification are implemented offline.
- Hardware upload/download/online features are either real and safe, or visibly disabled/model-only.
- AI can explain and propose changes across both ladder and HMI domains without direct mutation.
- Tests cover creation, editing, import/export, verification, runtime preview, AI plan/apply, and unsupported-content preservation.
