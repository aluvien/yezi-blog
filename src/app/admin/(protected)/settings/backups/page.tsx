import AdminPageHeader from "@/components/admin/AdminPageHeader";
import DataBackupPanel from "@/components/admin/DataBackupPanel";
import CloudBackupPanel from "@/components/admin/CloudBackupPanel";

export const dynamic = "force-dynamic";

export default function AdminBackupSettingsPage() {
  return (
    <div className="flex flex-col gap-5">
      <AdminPageHeader eyebrow="BACKUP & RESTORE" title="备份恢复" description="下载完整数据备份，配置 WebDAV 云存储，并校验和恢复历史备份。" />
      <DataBackupPanel />
      <CloudBackupPanel />
    </div>
  );
}
