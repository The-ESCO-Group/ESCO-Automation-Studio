import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Crash-safe boundary: if a render throws, show a recoverable fallback instead
 * of a blank page. Offline tool — nothing is reported anywhere; the message is
 * shown locally so the engineer can reload (the last export is unaffected).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Local only — surface to the console for debugging, never sent anywhere.
    console.error("ESCO Automation Studio crashed:", error, info.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="esco-crash" role="alert">
          <div className="esco-crash__box">
            <h1 className="esco-crash__title">Something went wrong</h1>
            <p className="esco-crash__msg">
              The app hit an unexpected error and stopped this view to stay safe. Your last exported
              project file is unaffected.
            </p>
            <pre className="esco-crash__detail">{this.state.error.message}</pre>
            <button type="button" className="esco-btn esco-btn--primary" onClick={this.handleReload}>
              Reload app
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
