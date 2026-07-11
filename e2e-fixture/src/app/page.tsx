import { Dashboard } from "@/components/Dashboard";
import { StatusCard } from "@/components/StatusCard";

export default function Page() {
  return (
    <main>
      <h1>RepoDiet E2E Test</h1>
      <Dashboard />
      <StatusCard label="Status" value="ACTIVE" />
    </main>
  );
}
