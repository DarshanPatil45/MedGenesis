export function MetricCluster({ items }: { items: { label: string; value: string }[] }) {
  if (!items.length) return null
  return (
    <div className="metric-cluster">
      {items.map((item) => (
        <div key={item.label} className="metric-cluster-item">
          <span className="metric-cluster-label">{item.label}</span>
          <span className="metric-cluster-value">{item.value}</span>
        </div>
      ))}
    </div>
  )
}
