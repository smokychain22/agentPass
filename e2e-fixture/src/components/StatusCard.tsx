import React from "react";

export function StatusCard({
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
