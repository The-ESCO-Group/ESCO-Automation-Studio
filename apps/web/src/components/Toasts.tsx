import type { Toast } from "../toasts";

interface Props {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

/** Stacked, non-blocking toasts pinned to the top of the window. */
export function Toasts({ toasts, onDismiss }: Props) {
  if (toasts.length === 0) return null;
  return (
    <div className="esco-toasts">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`esco-toast esco-toast--${toast.kind}`}
          role={toast.kind === "error" ? "alert" : "status"}
        >
          <span className="esco-toast__message">{toast.message}</span>
          <button
            type="button"
            className="esco-toast__close"
            aria-label="Dismiss"
            onClick={() => onDismiss(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
