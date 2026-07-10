import { Dashboard } from "@/components/Dashboard";
import { StatusCard } from "@/components/StatusCard";
import { formatStatus } from "@/lib/active-helper";

export default function Page() {
  return (
    <main>
      <h1>RepoDiet E2E Test</h1>
      <Dashboard />
      <StatusCard label="Status" value={formatStatus("active")} />
    </main>
  );
}
