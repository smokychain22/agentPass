import {
  createMaintenanceContractRecord,
  type MaintenanceContractRecord,
} from "../contract";

export interface PlannerResult {
  role: "planner";
  contractRecord: MaintenanceContractRecord;
  executableFindingCount: number;
}

/** Pure planning boundary: validates and hashes a proposal but performs no writes. */
export function planMaintenanceContract(input: unknown, now = new Date()): PlannerResult {
  const contractRecord = createMaintenanceContractRecord(input, now);
  return {
    role: "planner",
    contractRecord,
    executableFindingCount: contractRecord.contract.scope.findingIds.length,
  };
}
