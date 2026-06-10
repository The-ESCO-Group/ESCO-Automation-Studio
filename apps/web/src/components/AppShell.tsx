import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

const LEFT_MIN = 200;
const LEFT_MAX = 560;
const LEFT_DEFAULT = 300;
const LEFT_WIDTH_KEY = "esco.layout.leftWidth";

const clampLeftWidth = (width: number) => Math.max(LEFT_MIN, Math.min(LEFT_MAX, Math.round(width)));

function readStoredLeftWidth(): number {
  try {
    const raw = Number(window.localStorage.getItem(LEFT_WIDTH_KEY));
    if (Number.isFinite(raw) && raw >= LEFT_MIN && raw <= LEFT_MAX) return raw;
  } catch {
    /* localStorage unavailable — fall back to the default */
  }
  return LEFT_DEFAULT;
}

interface Props {
  startup?: boolean;
  topBar: ReactNode;
  ribbon: ReactNode;
  recovery?: ReactNode;
  toasts?: ReactNode;
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
  rightOpen?: boolean;
  onRightOpenChange?: (open: boolean) => void;
  bottomDock: ReactNode;
  statusBar: ReactNode;
}

/** Main IDE frame: app bar, ribbon, three-pane work area, dock, and status bar. */
export function AppShell({
  startup = false,
  topBar,
  ribbon,
  recovery,
  toasts,
  left,
  center,
  right,
  rightOpen = false,
  onRightOpenChange,
  bottomDock,
  statusBar,
}: Props) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [leftWidth, setLeftWidth] = useState<number>(readStoredLeftWidth);
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(LEFT_WIDTH_KEY, String(leftWidth));
    } catch {
      /* ignore persistence failures */
    }
  }, [leftWidth]);

  const onResizePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setResizing(true);
  }, []);
  const onResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) return;
      const rect = bodyRef.current?.getBoundingClientRect();
      if (!rect) return;
      setLeftWidth(clampLeftWidth(event.clientX - rect.left));
    },
    [],
  );
  const onResizePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setResizing(false);
  }, []);
  const onResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setLeftWidth((width) => clampLeftWidth(width - 16));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setLeftWidth((width) => clampLeftWidth(width + 16));
    } else if (event.key === "Home") {
      event.preventDefault();
      setLeftWidth(LEFT_DEFAULT);
    }
  }, []);

  if (startup) {
    return <div className="esco-app esco-app--startup">{toasts}</div>;
  }

  return (
    <div className="esco-app">
      {topBar}
      {ribbon}
      {toasts}
      {recovery}
      <div
        ref={bodyRef}
        className={`esco-body${rightOpen ? " is-right-open" : ""}${resizing ? " is-resizing" : ""}`}
        style={{ "--esco-left-width": `${leftWidth}px` } as CSSProperties}
      >
        <aside className="esco-left">{left}</aside>
        <div
          className="esco-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize project explorer"
          aria-valuenow={leftWidth}
          aria-valuemin={LEFT_MIN}
          aria-valuemax={LEFT_MAX}
          tabIndex={0}
          title="Drag to resize the project explorer (←/→ to adjust, Home to reset)"
          style={{ left: `${leftWidth}px` }}
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onKeyDown={onResizeKeyDown}
        />
        <div className="esco-main-stack">
          <main className="esco-center">{center}</main>
          <footer className="esco-bottom">{bottomDock}</footer>
        </div>
        {rightOpen ? (
          <aside className="esco-right is-open" aria-label="AI Copilot and inspector">
            <div className="esco-right__chrome">
              <span>AI Copilot</span>
              <button
                type="button"
                className="esco-right__close"
                onClick={() => onRightOpenChange?.(false)}
                aria-label="Close AI Copilot"
                title="Close AI Copilot"
              >
                ×
              </button>
            </div>
            <div className="esco-right__content">{right}</div>
          </aside>
        ) : null}
        <button
          type="button"
          className={`esco-inspector-handle${rightOpen ? " is-open" : ""}`}
          title={rightOpen ? "Hide AI Copilot" : "Show AI Copilot"}
          aria-label={rightOpen ? "Hide AI Copilot" : "Show AI Copilot"}
          onClick={() => onRightOpenChange?.(!rightOpen)}
        >
          AI
        </button>
      </div>
      {statusBar}
    </div>
  );
}
