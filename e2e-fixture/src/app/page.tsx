import { Dashboard } from "@/components/Dashboard";
import { StatusCard } from "@/components/StatusCard";
import { readCombinedDuplicateValue } from "@/lib/exact-dup-consumer";

export default function Page() {
  return (
    <main>
      <h1>RepoDiet E2E Test</h1>
      <Dashboard />
      <StatusCard label="Status" value="ACTIVE" />
      <p>Canonicalization fixture: {readCombinedDuplicateValue()}</p>
    </main>
  );
}
