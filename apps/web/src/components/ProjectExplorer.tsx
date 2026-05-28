import { Panel } from "@esco/ui";
import type { PlcProject } from "@esco/core";
import type { Selection } from "../selection";

interface Props {
  project: PlcProject;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}

export function ProjectExplorer({ project, selection, onSelect }: Props) {
  const isSelected = (kind: string, id: string) =>
    !!selection && selection.kind === kind && "id" in selection && selection.id === id;

  return (
    <Panel title="Project Explorer">
      <ul className="esco-tree">
        {project.controllers.map((controller) => (
          <li key={controller.id}>
            <button
              type="button"
              className={`esco-tree__node esco-tree__node--controller${
                isSelected("controller", controller.id) ? " is-selected" : ""
              }`}
              onClick={() => onSelect({ kind: "controller", id: controller.id })}
            >
              Controller · {controller.name}
            </button>

            <ul className="esco-tree esco-tree--nested">
              <li>
                <span className="esco-tree__group">Tasks</span>
                <ul className="esco-tree esco-tree--nested">
                  {controller.tasks.map((task) => (
                    <li key={task.id}>
                      <span className="esco-tree__leaf">{task.name} ({task.type})</span>
                    </li>
                  ))}
                </ul>
              </li>

              <li>
                <span className="esco-tree__group">Programs ({controller.programs.length})</span>
                <ul className="esco-tree esco-tree--nested">
                  {controller.programs.map((program) => (
                    <li key={program.id}>
                      <button
                        type="button"
                        className={`esco-tree__node${
                          isSelected("program", program.id) ? " is-selected" : ""
                        }`}
                        onClick={() => onSelect({ kind: "program", id: program.id })}
                      >
                        {program.name}
                      </button>
                      <ul className="esco-tree esco-tree--nested">
                        {program.routines.map((routine) => (
                          <li key={routine.id}>
                            <button
                              type="button"
                              className={`esco-tree__node esco-tree__node--routine${
                                isSelected("routine", routine.id) ? " is-selected" : ""
                              }`}
                              onClick={() =>
                                onSelect({ kind: "routine", id: routine.id })
                              }
                            >
                              {routine.name} · {routine.language}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </li>

              <li>
                <span className="esco-tree__group">
                  Controller Tags ({controller.controllerTags.length})
                </span>
                <ul className="esco-tree esco-tree--nested">
                  {controller.controllerTags.map((tag) => (
                    <li key={tag.id}>
                      <button
                        type="button"
                        className={`esco-tree__node esco-tree__node--tag${
                          isSelected("tag", tag.id) ? " is-selected" : ""
                        }`}
                        onClick={() => onSelect({ kind: "tag", id: tag.id })}
                      >
                        {tag.name} : {tag.dataType}
                        {tag.dimension ? `[${tag.dimension}]` : ""}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>

              {controller.dataTypes.length > 0 ? (
                <li>
                  <span className="esco-tree__group">Data Types ({controller.dataTypes.length})</span>
                  <ul className="esco-tree esco-tree--nested">
                    {controller.dataTypes.map((udt) => (
                      <li key={udt.id}>
                        <span className="esco-tree__leaf" title={`${udt.members.length} member(s)`}>
                          {udt.name} · {udt.members.length} member{udt.members.length === 1 ? "" : "s"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ) : null}

              {controller.addOnInstructions.length > 0 ? (
                <li>
                  <span className="esco-tree__group">
                    Add-On Instructions ({controller.addOnInstructions.length})
                  </span>
                  <ul className="esco-tree esco-tree--nested">
                    {controller.addOnInstructions.map((aoi) => (
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
                    ))}
                  </ul>
                </li>
              ) : null}

              {controller.ioConfiguration.modules.length > 0 ? (
                <li>
                  <span className="esco-tree__group">
                    I/O Modules ({controller.ioConfiguration.modules.length})
                  </span>
                  <ul className="esco-tree esco-tree--nested">
                    {controller.ioConfiguration.modules.map((module) => (
                      <li key={module.id}>
                        <span className="esco-tree__leaf">
                          {module.name}
                          {module.catalogNumber ? ` · ${module.catalogNumber}` : ""}
                          {module.slot != null ? ` · slot ${module.slot}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ) : null}
            </ul>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
