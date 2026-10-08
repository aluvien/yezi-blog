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

export type LocalBackupKind = "admin" | "database" | "data" | "restore";
export type LocalBackupFile = {
  kind: LocalBackupKind;
  name: string;
  createdAt: string;
  sizeBytes: number;
  encrypted: boolean;
};
export type LocalBackupList = {
  files: LocalBackupFile[];
  totalBytes: number;
  count: number;
  busy: boolean;
};
