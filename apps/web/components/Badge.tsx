export function Badge({ kind, value }: { kind: "sev" | "st"; value: string }) {
  return <span className={`badge ${kind}-${value}`}>{value}</span>;
}
