export function StatusCardCopy({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <section>
      <strong>{label}</strong>
      <span>{value}</span>
    </section>
  );
}
