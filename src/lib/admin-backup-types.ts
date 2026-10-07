export type AdminBackupPhase = "database" | "files" | "config" | "archive" | "verify" | "complete";

export type AdminBackupStatus = {
  id: string;
  status: "running" | "completed" | "failed";
  phase: AdminBackupPhase;
  createdAt: string;
  updatedAt: string;
  sizeBytes?: number;
  fileCount?: number;
  error?: string;
};
