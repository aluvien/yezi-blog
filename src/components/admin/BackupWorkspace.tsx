"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Cloud, Database, History } from "lucide-react";
import DataBackupPanel from "@/components/admin/DataBackupPanel";
import CloudBackupPanel from "@/components/admin/CloudBackupPanel";

export type BackupSummary = { count: number; totalBytes: number; latest: string | null };
export default function BackupWorkspace() {
  const router = useRouter();
  const search = useSearchParams();
  const active = search.get("tab") === "cloud" ? "cloud" : "local";
  const [local, setLocal] = useState<BackupSummary | null>(null);
  const [cloud, setCloud] = useState<BackupSummary | null>(null);
  const latest = [local?.latest, cloud?.latest].filter((value): value is string => Boolean(value)).sort().at(-1);
  function switchTab(tab: string) { const query = new URLSearchParams(search); query.set("tab", tab); router.replace(`?${query}`, { scroll: false }); }
  return <div className="admin-backup-workspace">
    <div className="admin-backup-summary">
      <div className="admin-card"><History size={19} /><span>最近备份</span><strong>{latest ? new Date(latest).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : local && cloud ? "暂无备份" : "尚未获取备份"}</strong><small>当前域名云备份与服务器本地备份</small></div>
      <div className="admin-card"><Database size={19} /><span>服务器本地</span><strong>{local ? `${local.count} 份` : "—"}</strong><small>{local ? `共 ${(local.totalBytes / 1024 / 1024).toFixed(2)} MB` : "正在读取备份列表"}</small></div>
      <div className="admin-card"><Cloud size={19} /><span>当前域名云备份</span><strong>{cloud ? `${cloud.count} 份` : "—"}</strong><small>{cloud ? `共 ${(cloud.totalBytes / 1024 / 1024).toFixed(2)} MB` : "请查看云端列表状态"}</small></div>
    </div>
    <div className="admin-backup-tabs" role="tablist" aria-label="备份存储位置">
      {(["local", "cloud"] as const).map((tab, index) => <button key={tab} id={`backup-tab-${tab}`} role="tab" aria-selected={active === tab} aria-controls={`backup-panel-${tab}`} tabIndex={active === tab ? 0 : -1} onClick={() => switchTab(tab)} onKeyDown={event => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          event.preventDefault(); const next = event.key === "Home" ? "local" : event.key === "End" ? "cloud" : index === 0 ? "cloud" : "local";
          switchTab(next); document.getElementById(`backup-tab-${next}`)?.focus();
        }
      }}>{tab === "local" ? <Database size={18} /> : <Cloud size={18} />}{tab === "local" ? "服务器本地" : "云端备份"}</button>)}
    </div>
    <div role="tabpanel" id="backup-panel-local" aria-labelledby="backup-tab-local" hidden={active !== "local"}><DataBackupPanel onSummary={setLocal} /></div>
    <div role="tabpanel" id="backup-panel-cloud" aria-labelledby="backup-tab-cloud" hidden={active !== "cloud"}><CloudBackupPanel onSummary={setCloud} /></div>
  </div>;
}
