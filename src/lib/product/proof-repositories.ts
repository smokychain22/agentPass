/**
 * Canonical repository roles for RepoDiet product proof.
 * The E2E fixture is regression-only — never the primary customer proof.
 */

export type ProofRepositoryRole =
  | "primary_complex_proof"
  | "dogfood_proof"
  | "regression_fixture_only";

export interface ProofRepository {
  role: ProofRepositoryRole;
  owner: string;
  name: string;
  url: string;
  purpose: string;
}

export const MERIDIAN_PROOF: ProofRepository = {
  role: "primary_complex_proof",
  owner: "velz-cmd",
  name: "Meridian",
  url: "https://github.com/velz-cmd/Meridian",
  purpose:
    "Primary complex proof — real large AI-built application with hundreds of files, routes, APIs, and historical implementations.",
};

export const AGENTPASS_DOGFOOD: ProofRepository = {
  role: "dogfood_proof",
  owner: "smokychain22",
  name: "agentPass",
  url: "https://github.com/smokychain22/agentPass",
  purpose: "Dogfood proof — RepoDiet analyzes and cleans its own codebase.",
};

export const E2E_REGRESSION_FIXTURE: ProofRepository = {
  role: "regression_fixture_only",
  owner: "velz-cmd",
  name: "repodiet-e2e-test",
  url: "https://github.com/velz-cmd/repodiet-e2e-test",
  purpose:
    "Internal regression fixture only — timeouts, crashes, idempotency, payment replay, protected paths. Not a customer success story.",
};

export const PROOF_REPOSITORIES: ProofRepository[] = [
  MERIDIAN_PROOF,
  AGENTPASS_DOGFOOD,
  E2E_REGRESSION_FIXTURE,
];

export function isRegressionFixtureOnly(owner: string, name: string): boolean {
  return (
    owner.toLowerCase() === E2E_REGRESSION_FIXTURE.owner.toLowerCase() &&
    name.toLowerCase() === E2E_REGRESSION_FIXTURE.name.toLowerCase()
  );
}

export function isPrimaryComplexProof(owner: string, name: string): boolean {
  return (
    owner.toLowerCase() === MERIDIAN_PROOF.owner.toLowerCase() &&
    name.toLowerCase() === MERIDIAN_PROOF.name.toLowerCase()
  );
}
