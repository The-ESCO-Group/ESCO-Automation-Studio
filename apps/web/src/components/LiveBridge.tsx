import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PlcProject } from "@esco/core";

const DEFAULT_URL = "http://127.0.0.1:7393/live";

/**
 * Live bridge — subscribes to the ESCO MCP server's project stream so edits made
 * by Claude (from a terminal / Claude Code) appear in the running Studio in real
 * time. Fully offline (localhost only). When the MCP server isn't running it
 * stays silent and keeps retrying via the browser's native EventSource backoff.
 */
export function LiveBridge({
  onProject,
  url = DEFAULT_URL,
}: {
  /** Called with each streamed project. `isFirst` is the initial snapshot on connect (adopt/open it). */
  onProject: (project: PlcProject, isFirst: boolean) => void;
  url?: string;
}) {
  const [connected, setConnected] = useState(false);
  const [editing, setEditing] = useState(false);
  const cbRef = useRef(onProject);
  cbRef.current = onProject;
  const editTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    let source: EventSource | null = null;
    try {
      source = new EventSource(url);
    } catch {
      return;
    }
    let first = true;
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as { type?: string; project?: PlcProject };
        if (message.type === "plc" && message.project) {
          cbRef.current(message.project, first);
          // The first message is the initial snapshot on connect; don't flash "edited".
          if (!first) {
            setEditing(true);
            window.clearTimeout(editTimer.current);
            editTimer.current = window.setTimeout(() => setEditing(false), 1600);
          }
          first = false;
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    return () => {
      window.clearTimeout(editTimer.current);
      source?.close();
    };
  }, [url]);

  if (!connected) return null;

  const recentlyEdited = editing;
  const node = (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 8,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 2147482000,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 12px",
        borderRadius: 999,
        fontSize: 11.5,
        fontWeight: 700,
        color: "#027a48",
        background: "#ecfdf3",
        border: "1px solid #abefc6",
        boxShadow: "0 6px 18px rgba(40,45,80,0.16)",
        pointerEvents: "none",
        transition: "background 0.2s ease",
        ...(recentlyEdited ? { color: "#4f46e5", background: "#eef0ff", borderColor: "#c7d2fe" } : {}),
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: recentlyEdited ? "#635bff" : "#12b76a", boxShadow: "0 0 6px currentColor" }} />
      {recentlyEdited ? "Claude is editing…" : "Live: connected to Claude (MCP)"}
    </div>
  );
  return createPortal(node, document.body);
}
