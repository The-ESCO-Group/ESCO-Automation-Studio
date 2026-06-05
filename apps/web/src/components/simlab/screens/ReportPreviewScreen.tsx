import { reportToCsv, reportToJson } from "@esco/sim-lab";
import { Card, KeyValue } from "./kit";
import type { ScreenProps } from "./types";

function download(name: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportPreviewScreen(props: ScreenProps) {
  const { api } = props;
  const r = api.report;

  return (
    <div data-testid="screen-report">
      <div className="sim2-row" style={{ marginBottom: 10 }}>
        <h2 className="sim2-h" style={{ margin: 0 }}>Report Preview</h2>
        <span className="sim2-bar-spacer" />
        <button type="button" className="sim2-btn sim2-btn--primary" data-testid="report-generate" onClick={api.generateReport}>Generate report</button>
        {r && <>
          <button type="button" className="sim2-btn" onClick={() => download("esco-sim-report.json", reportToJson(r), "application/json")} data-testid="report-json">JSON</button>
          <button type="button" className="sim2-btn" onClick={() => download("esco-sim-report.csv", reportToCsv(r), "text/csv")} data-testid="report-csv">CSV</button>
        </>}
      </div>

      {!r && <div className="sim2-empty">Run scenarios in the FAT/SAT tab, then generate the ESCO-native commissioning report.</div>}

      {r && (
        <div className="sim2-report" data-testid="report-doc">
          <div className="sim2-report__title">
            <strong style={{ fontSize: 17 }}>ESCO Commissioning Test Report</strong>
            <span className="sim2-bar-spacer" />
            <span className={`sim2-report__verdict is-${r.status}`}>{r.status.toUpperCase()}</span>
          </div>

          <div className="sim2-grid sim2-grid--2">
            <Card title="Project summary">
              <KeyValue rows={[
                ["Project", r.project.name],
                ["Process type", r.project.processType],
                ["Controller model", r.project.controller],
                ["Scan rate", `${r.project.scanRateMs} ms`],
                ["Generated", r.createdAtLabel],
              ]} />
            </Card>
            <Card title="Coverage">
              <KeyValue rows={[
                ["Devices tested", String(r.summary.devices)],
                ["Virtual tags", String(r.summary.tags)],
                ["I/O channels tested", `${r.ioChannelsTested.exercised}/${r.ioChannelsTested.total}`],
                ["Logic paths covered", String(r.summary.logicBlocks)],
                ["HMI actions tested", String(r.hmiActionsTested.length)],
                ["Trends captured", String(r.trendsCaptured.length)],
                ["Scenarios", `${r.summary.scenariosPassed}/${r.summary.scenarios} passed`],
                ["Checks", `${r.summary.checksPassed}/${r.summary.checks} passed`],
              ]} />
            </Card>
          </div>

          <div className="sim2-grid sim2-grid--2" style={{ marginTop: 12 }}>
            <Card title="Devices tested">
              <table className="sim2-table">
                <thead><tr><th>Tag</th><th>Kind</th><th className="num">Tags</th></tr></thead>
                <tbody>{r.devicesTested.map((d) => <tr key={d.tag}><td className="sim2-mono">{d.tag}</td><td>{d.kind}</td><td className="num">{d.tagCount}</td></tr>)}</tbody>
              </table>
            </Card>
            <Card title="Alarms proven">
              <table className="sim2-table">
                <thead><tr><th>Alarm</th><th>Proven</th></tr></thead>
                <tbody>{r.alarmsProven.map((a) => <tr key={a.alarm}><td className="sim2-mono">{a.alarm}</td><td>{a.proven ? "✓" : "—"}</td></tr>)}</tbody>
              </table>
            </Card>
          </div>

          {r.failedExpectations.length > 0 && (
            <Card title={`Failed expectations (${r.failedExpectations.length})`}>
              {r.failedExpectations.map((f, i) => (
                <div key={i} className="sim2-check is-fail">✗ {f.scenario}: {f.description} — expected {f.expected}, got {f.actual}</div>
              ))}
            </Card>
          )}

          <div className="sim2-report__boundary" data-testid="report-boundary">{r.boundary}</div>
          <p className="sim2-muted" style={{ fontSize: 11 }}>{r.notice}</p>
        </div>
      )}
    </div>
  );
}
