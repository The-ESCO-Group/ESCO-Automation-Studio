import { useState } from "react";
import { Panel } from "@esco/ui";
import type { PlcProject } from "@esco/core";
import { getHmiProject } from "@esco/hmi-model";
import type { Selection } from "../selection";

interface Props {
  project: PlcProject;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  empty?: boolean;
}

export function ProjectExplorer({ project, selection, onSelect, empty = false }: Props) {
  const [tab, setTab] = useState<"controllers" | "hmi" | "assets" | "library">("controllers");
  const [filter, setFilter] = useState("");
  const filterText = filter.trim().toLowerCase();
  const matchesFilter = (value: string) => !filterText || value.toLowerCase().includes(filterText);
  const isSelected = (kind: string, id: string) =>
    !!selection && selection.kind === kind && "id" in selection && selection.id === id;
  const controller = project.controllers[0];
  const hmi = getHmiProject(project);

  return (
    <Panel title="Project Explorer">
      {empty ? (
        <ul className="esco-tree esco-tree--empty">
          <li>
            <span className="esco-tree__group"><span className="esco-tree__icon">▾</span>Controllers</span>
            <ul className="esco-tree esco-tree--nested">
              <li><span className="esco-tree__leaf"><span className="esco-tree__icon">□</span>No controllers added</span></li>
            </ul>
          </li>
          <li>
            <span className="esco-tree__group"><span className="esco-tree__icon">▾</span>Programs</span>
            <ul className="esco-tree esco-tree--nested">
              <li><span className="esco-tree__leaf"><span className="esco-tree__icon">□</span>No programs added</span></li>
            </ul>
          </li>
          <li>
            <span className="esco-tree__group"><span className="esco-tree__icon">▾</span>Tasks</span>
            <ul className="esco-tree esco-tree--nested">
              <li><span className="esco-tree__leaf"><span className="esco-tree__icon">□</span>No tasks added</span></li>
            </ul>
          </li>
          <li>
            <span className="esco-tree__group"><span className="esco-tree__icon">▾</span>I/O</span>
            <ul className="esco-tree esco-tree--nested">
              <li><span className="esco-tree__leaf"><span className="esco-tree__icon">□</span>Local</span></li>
              <li><span className="esco-tree__leaf"><span className="esco-tree__icon">□</span>Remote</span></li>
              <li><span className="esco-tree__leaf esco-tree__leaf--muted">No I/O configured</span></li>
            </ul>
          </li>
          <li>
            <span className="esco-tree__group"><span className="esco-tree__icon">▾</span>Assets</span>
            <ul className="esco-tree esco-tree--nested">
              {["Libraries", "Data Types", "User-Defined", "Trends"].map((label) => (
                <li key={label}><span className="esco-tree__leaf"><span className="esco-tree__icon">□</span>{label}</span></li>
              ))}
              <li><span className="esco-tree__leaf esco-tree__leaf--muted">No assets added</span></li>
            </ul>
          </li>
        </ul>
      ) : (
      <>
      <div className="esco-explorer__filter">
        <span aria-hidden="true">⌕</span>
        <input
          value={filter}
          placeholder="Filter project"
          spellCheck={false}
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>
      <div className="esco-explorer__tabs">
        {[
          ["controllers", "Controllers"],
          ["hmi", "HMI"],
          ["assets", "Assets"],
          ["library", "Library"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`esco-explorer__tab${tab === id ? " is-active" : ""}`}
            onClick={() => setTab(id as typeof tab)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "controllers" ? (
        <ul className="esco-tree">
          <li>
            <button
              type="button"
              className={`esco-tree__root esco-tree__root--button${
                isSelected("project", project.id) ? " is-selected" : ""
              }`}
              onClick={() => onSelect({ kind: "project", id: project.id })}
            >
              <span className="esco-tree__icon" aria-hidden="true">▾</span>
              Project Root
              <span className="esco-tree__meta">{project.name}</span>
            </button>
            <ul className="esco-tree esco-tree--nested">
              {project.controllers.map((controller) => (
                <li key={controller.id}>
                  <button
                    type="button"
                    className={`esco-tree__node esco-tree__node--controller${
                      isSelected("controller", controller.id) ? " is-selected" : ""
                    }`}
                    onClick={() => onSelect({ kind: "controller", id: controller.id })}
                  >
                    <span className="esco-tree__icon" aria-hidden="true">▾</span>
                    Controller
                    <span className="esco-tree__meta">{controller.name}</span>
                  </button>

                  <ul className="esco-tree esco-tree--nested">
                    <li>
                      <span className="esco-tree__group">
                        <span className="esco-tree__icon" aria-hidden="true">▾</span>
                        Controller Tags ({controller.controllerTags.length})
                      </span>
                      <ul className="esco-tree esco-tree--nested">
                        {controller.controllerTags.filter((tag) => matchesFilter(tag.name)).map((tag) => (
                          <li key={tag.id}>
                            <button
                              type="button"
                              className={`esco-tree__node esco-tree__node--tag${
                                isSelected("tag", tag.id) ? " is-selected" : ""
                              }`}
                              onClick={() => onSelect({ kind: "tag", id: tag.id })}
                            >
                              <span className="esco-tree__icon" aria-hidden="true">#</span>
                              {tag.name} : {tag.dataType}
                              {tag.dimension ? `[${tag.dimension}]` : ""}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </li>

                    <li>
                      <span className="esco-tree__group">
                        <span className="esco-tree__icon" aria-hidden="true">▾</span>
                        Tasks
                      </span>
                      <ul className="esco-tree esco-tree--nested">
                        {controller.tasks.map((task) => (
                          <li key={task.id}>
                            <button
                              type="button"
                              className={`esco-tree__node esco-tree__node--task${
                                isSelected("task", task.id) ? " is-selected" : ""
                              }`}
                              onClick={() => onSelect({ kind: "task", id: task.id })}
                            >
                              <span className="esco-tree__icon" aria-hidden="true">□</span>
                              {task.name} ({task.type})
                            </button>
                          </li>
                        ))}
                      </ul>
                    </li>

                    <li>
                      <span className="esco-tree__group">
                        <span className="esco-tree__icon" aria-hidden="true">▾</span>
                        Programs ({controller.programs.length})
                      </span>
                      <ul className="esco-tree esco-tree--nested">
                        {controller.programs.map((program) => (
                          <li key={program.id}>
                            <button
                              type="button"
                              className={`esco-tree__node${isSelected("program", program.id) ? " is-selected" : ""}`}
                              onClick={() => onSelect({ kind: "program", id: program.id })}
                            >
                              <span className="esco-tree__icon" aria-hidden="true">▾</span>
                              {program.name}
                            </button>
                            <ul className="esco-tree esco-tree--nested">
                              <li>
                                <span className="esco-tree__group">Routines ({program.routines.length})</span>
                                <ul className="esco-tree esco-tree--nested">
                                  {program.routines.filter((routine) => matchesFilter(routine.name)).map((routine) => (
                                    <li key={routine.id}>
                                      <button
                                        type="button"
                                        className={`esco-tree__node esco-tree__node--routine${
                                          isSelected("routine", routine.id) ? " is-selected" : ""
                                        }`}
                                        onClick={() => onSelect({ kind: "routine", id: routine.id })}
                                      >
                                        <span className="esco-tree__icon" aria-hidden="true">LD</span>
                                        {routine.name}
                                        <span className="esco-tree__meta">{routine.language}</span>
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              </li>
                            </ul>
                          </li>
                        ))}
                      </ul>
                    </li>

                    <li>
                      <span className="esco-tree__group">AOIs / Add-On Instructions ({controller.addOnInstructions.length})</span>
                      <ul className="esco-tree esco-tree--nested">
                        {controller.addOnInstructions.length === 0 ? (
                          <li><span className="esco-tree__leaf">No add-on instructions</span></li>
                        ) : (
                          controller.addOnInstructions.map((aoi) => (
                            <li key={aoi.id}>
                              <button
                                type="button"
                                className={`esco-tree__node esco-tree__node--aoi${
                                  isSelected("aoi", aoi.id) ? " is-selected" : ""
                                }`}
                                title={aoi.description ?? ""}
                                onClick={() => onSelect({ kind: "aoi", id: aoi.id })}
                              >
                                {aoi.name}
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                    </li>

                    <li>
                      <span className="esco-tree__group">UDTs / Data Types ({controller.dataTypes.length})</span>
                      <ul className="esco-tree esco-tree--nested">
                        {controller.dataTypes.length === 0 ? (
                          <li><span className="esco-tree__leaf">No user-defined data types</span></li>
                        ) : (
                          controller.dataTypes.map((udt) => (
                            <li key={udt.id}>
                              <button
                                type="button"
                                className={`esco-tree__node esco-tree__node--udt${
                                  isSelected("udt", udt.id) ? " is-selected" : ""
                                }`}
                                title={`${udt.members.length} member(s)`}
                                onClick={() => onSelect({ kind: "udt", id: udt.id })}
                              >
                                {udt.name}
                                <span className="esco-tree__meta">{udt.members.length} member{udt.members.length === 1 ? "" : "s"}</span>
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                    </li>

                    <li>
                      <button
                        type="button"
                        className="esco-tree__group esco-tree__group--button"
                        title="Open the I/O configuration"
                        onClick={() => onSelect({ kind: "io", controllerId: controller.id })}
                      >
                        I/O Configuration / I/O Modules ({controller.ioConfiguration.modules.length})
                      </button>
                      <ul className="esco-tree esco-tree--nested">
                        {controller.ioConfiguration.modules.length === 0 ? (
                          <li><span className="esco-tree__leaf">No modules imported</span></li>
                        ) : (
                          controller.ioConfiguration.modules.map((module) => (
                            <li key={module.id}>
                              <button
                                type="button"
                                className={`esco-tree__node esco-tree__node--module${
                                  !!selection && selection.kind === "io" && selection.moduleId === module.id
                                    ? " is-selected"
                                    : ""
                                }`}
                                onClick={() => onSelect({ kind: "io", controllerId: controller.id, moduleId: module.id })}
                              >
                                {module.name}
                                {module.catalogNumber ? ` · ${module.catalogNumber}` : ""}
                                {module.slot != null ? ` · slot ${module.slot}` : ""}
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                    </li>

                    <li>
                      <span className="esco-tree__group">Compare / Reports</span>
                    </li>
                  </ul>
                </li>
              ))}
            </ul>
          </li>
        </ul>
      ) : tab === "hmi" ? (
        <ul className="esco-tree">
          <li>
            <button
              type="button"
              className={`esco-tree__root esco-tree__root--button${
                isSelected("hmi", hmi?.id ?? project.id) ? " is-selected" : ""
              }`}
              onClick={() => onSelect({ kind: "hmi", id: hmi?.id ?? project.id })}
            >
              <span className="esco-tree__icon" aria-hidden="true">▾</span>
              HMI Project
              <span className="esco-tree__meta">{hmi?.name ?? "not configured"}</span>
            </button>
            {hmi ? (
              <ul className="esco-tree esco-tree--nested">
                <li>
                  <span className="esco-tree__group">
                    <span className="esco-tree__icon" aria-hidden="true">▾</span>
                    HMI Device
                  </span>
                  <ul className="esco-tree esco-tree--nested">
                    <li>
                      <span className="esco-tree__leaf">
                        {hmi.targetDevice.name}
                        <span className="esco-tree__meta">{hmi.targetDevice.width}x{hmi.targetDevice.height}</span>
                      </span>
                    </li>
                  </ul>
                </li>
                <li>
                  <span className="esco-tree__group">
                    <span className="esco-tree__icon" aria-hidden="true">▾</span>
                    Screens ({hmi.screens.length})
                  </span>
                  <ul className="esco-tree esco-tree--nested">
                    {hmi.screens.length ? (
                      hmi.screens.map((screen) => (
                        <li key={screen.id}>
                          <button
                            type="button"
                            className={`esco-tree__node esco-tree__node--routine${
                              isSelected("hmi-screen", screen.id) ? " is-selected" : ""
                            }`}
                            onClick={() => onSelect({ kind: "hmi-screen", id: screen.id })}
                          >
                            <span className="esco-tree__icon" aria-hidden="true">HMI</span>
                            {screen.name}
                            {hmi.homeScreenId === screen.id ? <span className="esco-tree__meta">home</span> : null}
                          </button>
                        </li>
                      ))
                    ) : (
                      <li><span className="esco-tree__leaf">No screens created</span></li>
                    )}
                  </ul>
                </li>
                <li>
                  <span className="esco-tree__group">Popups ({hmi.popups.length})</span>
                  <ul className="esco-tree esco-tree--nested">
                    {hmi.popups.length ? (
                      hmi.popups.map((popup) => (
                        <li key={popup.id}>
                          <button
                            type="button"
                            className={`esco-tree__node${isSelected("hmi-popup", popup.id) ? " is-selected" : ""}`}
                            onClick={() => onSelect({ kind: "hmi-popup", id: popup.id })}
                          >
                            {popup.name}
                            <span className="esco-tree__meta">{popup.width}x{popup.height}</span>
                          </button>
                        </li>
                      ))
                    ) : (
                      <li><span className="esco-tree__leaf">No popups created</span></li>
                    )}
                  </ul>
                </li>
                <li>
                  <button
                    type="button"
                    className={`esco-tree__group esco-tree__group--button${
                      isSelected("hmi-banner", hmi.systemBanner.id) ? " is-selected" : ""
                    }`}
                    onClick={() => onSelect({ kind: "hmi-banner", id: hmi.systemBanner.id })}
                  >
                    System Banner
                  </button>
                </li>
                <li><span className="esco-tree__group">Alarm Views ({hmi.alarmViews.length})</span></li>
                <li><span className="esco-tree__group">Diagnostics Views ({hmi.diagnosticsViews.length})</span></li>
                <li><span className="esco-tree__group">Trends ({hmi.trends.length})</span></li>
                <li><span className="esco-tree__group">Data Logs ({hmi.dataLogs.length})</span></li>
                <li><span className="esco-tree__group">Security ({hmi.security.roles.length} roles)</span></li>
                <li><span className="esco-tree__group">Language Packs ({hmi.languagePacks.length})</span></li>
                <li><span className="esco-tree__group">Images / PDFs ({hmi.assets.length})</span></li>
                <li><span className="esco-tree__group">Unsupported Preserved Content ({hmi.unsupportedContent.length})</span></li>
              </ul>
            ) : (
              <ul className="esco-tree esco-tree--nested">
                <li><span className="esco-tree__leaf">Open the HMI Designer to create the project model.</span></li>
              </ul>
            )}
          </li>
        </ul>
      ) : tab === "assets" ? (
        <ul className="esco-tree">
          <li><span className="esco-tree__group">Controller Tags ({controller?.controllerTags.length ?? 0})</span></li>
          <li><span className="esco-tree__group">Program Tags ({controller?.programs.flatMap((program) => program.programTags).length ?? 0})</span></li>
          <li><span className="esco-tree__group">Data Types ({controller?.dataTypes.length ?? 0})</span></li>
          <li><span className="esco-tree__group">AOIs / Add-On Instructions ({controller?.addOnInstructions.length ?? 0})</span></li>
          <li><span className="esco-tree__group">I/O Configuration / I/O Modules ({controller?.ioConfiguration.modules.length ?? 0})</span></li>
        </ul>
      ) : (
        <ul className="esco-tree">
          {["Bit", "Timer / Counter", "Move / Math", "Compare", "Program Control"].map((group) => (
            <li key={group}><span className="esco-tree__group">{group}</span></li>
          ))}
        </ul>
      )}
      </>
      )}
    </Panel>
  );
}
