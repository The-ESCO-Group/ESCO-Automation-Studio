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
    setToasts((current) => [...current, { id: nextId++, kind, message }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  return { toasts, push, dismiss };
}
