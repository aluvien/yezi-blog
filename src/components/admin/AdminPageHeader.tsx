import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

type AdminPageHeaderProps = {
  eyebrow: string;
  title: ReactNode;
  description: string;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
};

export default function AdminPageHeader({ eyebrow, title, description, actions, backHref, backLabel = "返回列表" }: AdminPageHeaderProps) {
  return (
    <header className="admin-page-header">
      <div className="min-w-0">
        {backHref && <Link href={backHref} className="admin-back-link"><ArrowLeft size={14} aria-hidden="true" />{backLabel}</Link>}
        <p className="admin-page-eyebrow">{eyebrow}</p>
        <h1 className="admin-page-title">{title}</h1>
        <p className="admin-page-description">{description}</p>
      </div>
      {actions && <div className="admin-page-actions shrink-0">{actions}</div>}
    </header>
  );
}
