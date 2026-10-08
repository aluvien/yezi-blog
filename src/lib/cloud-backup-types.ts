export type CloudBackupSettings = {
  endpoint: string;
  username: string;
  directory: string;
  dailyEnabled: boolean;
  keep: number;
  hasPassword: boolean;
  hasKey: boolean;
};
export type CloudBackupFile = { name: string; sizeBytes: number; createdAt: string; site?: string };
export type CloudBackupPhase = "snapshot" | "encrypt" | "upload" | "verify" | "download" | "decrypt" | "validate" | "ready" | "safety" | "restore" | "complete";
export type CloudRestorePreview = {
  createdAt: string;
  files: number;
  posts: number;
  moments: number;
  attachments: number;
  schemaVersion: number;
  configurationFiles: number;
};
export type CloudBackupTask = {
  id: string;
  kind: "test" | "backup" | "prepare";
  status: "running" | "completed" | "failed";
  phase: CloudBackupPhase;
  createdAt: string;
  updatedAt: string;
  name?: string;
  error?: string;
  warning?: string;
  preview?: CloudRestorePreview;
  safetyBackup?: string;
};
