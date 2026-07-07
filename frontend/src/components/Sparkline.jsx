export default function Sparkline({ series = [], color = "var(--violet)" }) {
  if (!series.length) return <div className="spark" />;
  const values = series.slice(-14).map((d) => d.value);
  const max = Math.max(...values, 1);

  return (
    <div className="spark">
      {values.map((v, i) => (
        <div
          key={i}
          className="spark-b"
          style={{
            height: `${Math.max(Math.round((v / max) * 100), 4)}%`,
            background: color,
            animation: `bUp .4s var(--out) ${(i * 0.04).toFixed(2)}s both`,
          }}
        />
      ))}
    </div>
  );
}