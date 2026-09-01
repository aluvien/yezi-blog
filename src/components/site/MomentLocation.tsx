export function MomentLocation({ location }: { location: string }) {
  const label = location.trim();
  if (!label) return null;
  return (
    <span className="moment-location" title={`发布位置：${label}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
        <circle cx="12" cy="10" r="2.5" />
      </svg>
      <span>{label}</span>
    </span>
  );
}
