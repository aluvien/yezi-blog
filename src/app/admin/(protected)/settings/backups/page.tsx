import AdminPageHeader from "@/components/admin/AdminPageHeader";
import BackupWorkspace from "@/components/admin/BackupWorkspace";

export const dynamic = "force-dynamic";

export default function AdminBackupSettingsPage() {
  return (
    <div className="flex flex-col gap-5">
      <AdminPageHeader eyebrow="BACKUP & RESTORE" title="备份恢复" description="管理本地与云端备份，按需恢复网站数据。" />
      <BackupWorkspace />
    </div>
  );
}
