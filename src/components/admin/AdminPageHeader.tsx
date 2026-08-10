import type { ReactNode } from "react";

type AdminPageHeaderProps = {
  eyebrow: string;
  title: ReactNode;
  description: string;
  actions?: ReactNode;
};

export default function AdminPageHeader({ eyebrow, title, description, actions }: AdminPageHeaderProps) {
  return (
    <div className="admin-page-header flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="admin-page-eyebrow">{eyebrow}</p>
        <h1 className="admin-page-title">{title}</h1>
        <p className="admin-page-description">{description}</p>
      </div>
      {actions && <div className="admin-page-actions shrink-0">{actions}</div>}
    </div>
  );
}
