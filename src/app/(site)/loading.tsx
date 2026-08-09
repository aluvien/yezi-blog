export default function Loading() {
  return (
    <div className="site-route-loading" role="status" aria-live="polite" aria-label="页面加载中" aria-busy="true">
      <span className="site-route-loading-kicker" />
      <span className="site-route-loading-title" />
      <span className="site-route-loading-meta" />
      <div className="site-route-loading-copy" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
