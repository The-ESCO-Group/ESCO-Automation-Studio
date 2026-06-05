export const CONFIRMATION_EVENT = "esco-confirmation-request";

export type ConfirmationTone = "danger" | "warning" | "info";

export interface ConfirmationRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmationTone;
}

export interface ConfirmationRequestDetail extends ConfirmationRequest {
  resolve: (confirmed: boolean) => void;
}

export function requestConfirmation(request: ConfirmationRequest): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    window.dispatchEvent(
      new CustomEvent<ConfirmationRequestDetail>(CONFIRMATION_EVENT, {
        detail: { ...request, resolve },
      }),
    );
  });
}
