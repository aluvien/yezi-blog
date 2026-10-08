export type CloudBackupSettings = {
  siteLabel: string;
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
export type CloudBackupTransfer = {
  totalBytes: number;
  transferredBytes: number;
  bytesPerSecond: number;
  elapsedSeconds: number;
  remainingSeconds: number | null;
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
  transfer?: CloudBackupTransfer;
  preview?: CloudRestorePreview;
  safetyBackup?: string;
};
