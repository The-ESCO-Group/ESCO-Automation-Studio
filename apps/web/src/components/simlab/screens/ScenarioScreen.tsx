import { availableScenarioTemplates, SCENARIO_TEMPLATES } from "@esco/sim-lab";
import { Card, Pill } from "./kit";
import type { ScreenProps } from "./types";

export function ScenarioScreen(props: ScreenProps) {
  const { api, src } = props;
  const project = src.project;
  const available = availableScenarioTemplates(project);

  return (
    <div data-testid="screen-fat">
      <div className="sim2-row" style={{ marginBottom: 10 }}>
        <h2 className="sim2-h" style={{ margin: 0 }}>FAT / SAT Commissioning</h2>
        <span className="sim2-bar-spacer" />
        <button type="button" className="sim2-btn sim2-btn--primary" data-testid="fat-run-all" disabled={project.scenarios.length === 0} onClick={api.runAll}>Run All</button>
        <button type="button" className="sim2-btn" data-testid="fat-reset" onClick={api.engineReset}>Reset Simulation</button>
      </div>

      <Card title="Add scenario">
        <div className="sim2-row">
          {SCENARIO_TEMPLATES.map((t) => {
            const enabled = available.some((a) => a.kind === t.kind);
            return (
              <button key={t.kind} type="button" className="sim2-btn sim2-btn--sm" disabled={!enabled} title={enabled ? t.description : "Requires device(s) not in this project."} data-testid={`fat-add-${t.kind}`} onClick={() => api.addScenario(t.kind)}>
                + {t.label}
              </button>
            );
          })}
        </div>
      </Card>

      <div className="sim2-grid sim2-grid--2" style={{ marginTop: 12 }}>
        {project.scenarios.map((s) => {
          const result = api.results.find((r) => r.scenarioId === s.id);
          const verdict = result?.status ?? "draft";
          const relatedDevices = [...new Set(s.actions.map((a) => a.deviceId).filter(Boolean).map((id) => project.devices.find((d) => d.id === id)?.tag).filter(Boolean) as string[])];
          return (
            <Card
              key={s.id}
              testId={`fat-card-${s.templateKind ?? s.id}`}
              title={<span><Pill tone={verdict === "pass" ? "good" : verdict === "fail" ? "fault" : verdict === "error" ? "warning" : "idle"}>{String(verdict).toUpperCase()}</Pill> {s.name}</span>}
              actions={<button type="button" className="sim2-btn sim2-btn--sm sim2-btn--primary" data-testid={`fat-run-${s.id}`} onClick={() => api.runOne(s.id)}>Run</button>}
            >
              <div className="sim2-scn">
                <p className="sim2-muted" style={{ margin: 0 }}>{s.description}</p>

                <div>
                  <strong>Preconditions</strong>
                  <div className="sim2-muted" style={{ fontSize: 12 }}>{s.initialConditions.length ? s.initialConditions.map((c) => `${c.tag}=${String(c.value)}`).join(", ") : "Power-up state"}{relatedDevices.length ? ` · devices: ${relatedDevices.join(", ")}` : ""}</div>
                </div>

                <div>
                  <strong>Steps</strong>
                  <ol className="sim2-scn__steps">
                    {s.actions.map((a) => <li key={a.id}>{a.atMs}ms — {a.note ?? a.kind}</li>)}
                  </ol>
                </div>

                <div>
                  <strong>Expected vs actual</strong>
                  {!result && <div className="sim2-muted" style={{ fontSize: 12 }}>{[...s.expectedTags, ...s.expectedAlarms, ...s.expectedEvents].length} expectation(s). Run to evaluate.</div>}
                  {result && result.checks.map((c) => (
                    <div key={c.id} className={`sim2-check${c.passed ? "" : " is-fail"}`} data-testid={c.passed ? undefined : "fat-failed-check"}>
                      <span>{c.passed ? "✓" : "✗"}</span>
                      <span style={{ flex: 1 }}>{c.description}</span>
                      <span className="sim2-mono sim2-muted">{c.actual}</span>
                    </div>
                  ))}
                </div>

                {result && (
                  <div>
                    <strong>Evidence ({result.evidence.length})</strong>
                    <div style={{ maxHeight: 120, overflow: "auto", fontSize: 11 }} className="sim2-mono">
                      {result.evidence.slice(-10).map((e) => <div key={e.seq}><span className="sim2-muted">{e.timeMs}ms</span> {e.message}</div>)}
                    </div>
                  </div>
                )}

                {s.expectedAlarms.length > 0 && (
                  <div className="sim2-muted" style={{ fontSize: 11 }}>Alarms: {s.expectedAlarms.map((a) => a.alarm).join(", ")}</div>
                )}
              </div>
            </Card>
          );
        })}
        {project.scenarios.length === 0 && <div className="sim2-empty">No scenarios. Add one above to begin commissioning.</div>}
      </div>
    </div>
  );
}
