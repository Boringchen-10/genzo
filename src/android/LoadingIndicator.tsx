export default function LoadingIndicator({ label = "正在加载…", compact = false }: { label?: string; compact?: boolean }) {
  return <div className={`gz-load-indicator${compact ? " compact" : ""}`} role="status" aria-label={label}>
    <span className="gz-load-shape" aria-hidden="true">{[0, 1, 2, 3].map(index => <i key={index} style={{ "--petal": index } as React.CSSProperties} />)}</span>
    <span>{label}</span>
  </div>;
}
