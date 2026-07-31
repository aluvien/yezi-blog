export function PageHeader({
  eyebrow,
  title,
  description,
  trailing,
}: {
  eyebrow: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <header className="mb-7 flex items-end justify-between gap-6 border-b border-divider pb-7 md:mb-9">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-accent">{eyebrow}</p>
        <h1 className="mt-3 text-[34px] font-semibold tracking-[-0.045em] md:text-[42px]">{title}</h1>
        {description && <p className="mt-3 max-w-xl text-[14px] leading-7 text-muted">{description}</p>}
      </div>
      {trailing && <div className="pb-1 text-[12px] text-muted">{trailing}</div>}
    </header>
  );
}
