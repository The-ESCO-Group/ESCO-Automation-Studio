import type { ReactNode } from "react";

export interface PanelProps {
  title: string;
  /** Optional content rendered on the right side of the panel header. */
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** A titled container used for the IDE's docked panels. */
export function Panel({ title, actions, children, className }: PanelProps) {
  return (
    <section className={`esco-panel${className ? ` ${className}` : ""}`}>
      <header className="esco-panel__header">
        <span className="esco-panel__title">{title}</span>
        {actions ? <div className="esco-panel__actions">{actions}</div> : null}
      </header>
      <div className="esco-panel__body">{children}</div>
    </section>
  );
}
