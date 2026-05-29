import { useCallback, useState } from "react";

export type ToastKind = "success" | "info" | "warning" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

let nextId = 1;

/** Lightweight toast queue: push typed messages, dismiss by id. */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = nextId++;
    setToasts((current) => {
      const deduped = current.filter((toast) => toast.kind !== kind || toast.message !== message);
      return [...deduped, { id, kind, message }].slice(-4);
    });

    const ttl = kind === "error" ? 6500 : kind === "warning" ? 4600 : 2600;
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, ttl);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  return { toasts, push, dismiss };
}
