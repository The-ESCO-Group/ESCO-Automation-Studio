import type { ImportSummary } from "@esco/parser-l5x";
import type { RecentProjectEntry } from "../recent-projects";

interface Props {
  onCreateRoutine: () => void;
  onImportProject: () => void;
  onImportL5X: () => void;
  onExport: () => void;
  onOpenAi: () => void;
  onOpenCrossRef: () => void;
  onOpenWatch: () => void;
  onOpenTags: () => void;
  onOpenCompare: () => void;
  onOpenRecentProject: (entry: RecentProjectEntry) => void;
  projectOpen: boolean;
  recentProjects: RecentProjectEntry[];
  lastImport?: { name: string; summary: ImportSummary } | null;
}

export function WelcomeDashboard(_props: Props) {
  return <div className="esco-welcome esco-welcome--blank" aria-label="No project open" />;
}
