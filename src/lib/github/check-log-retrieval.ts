import { GitHubClient } from "@/lib/github/github-client";
import { firstActionableLogLine, redactSensitiveLogExcerpt } from "@/lib/github/log-redaction";

export interface GitHubActionsEvidence {
  workflowName?: string;
  jobName?: string;
  failedStep?: string;
  annotations: string[];
  logExcerpt?: string;
  logsAvailable: boolean;
}

export async function retrieveGitHubActionsEvidence(input: {
  client: GitHubClient;
  owner: string;
  repo: string;
  headSha: string;
  checkName: string;
}): Promise<GitHubActionsEvidence> {
  const runs = await input.client.listWorkflowRunsForCommit(
    input.owner,
    input.repo,
    input.headSha
  );

  const matchingRun =
    runs.find((run) => run.name.toLowerCase() === input.checkName.toLowerCase()) ?? runs[0];
  if (!matchingRun) {
    return { annotations: [], logsAvailable: false };
  }

  const jobs = await input.client.listWorkflowRunJobs(
    input.owner,
    input.repo,
    matchingRun.id
  );
  const failedJob =
    jobs.find((job) => job.conclusion === "failure") ??
    jobs.find((job) => job.status === "completed" && job.conclusion !== "success");

  if (!failedJob) {
    return {
      workflowName: matchingRun.name,
      annotations: [],
      logsAvailable: false,
    };
  }

  const failedStep = failedJob.steps?.find((step) => step.conclusion === "failure");
  const rawLog = await input.client.downloadWorkflowJobLog(
    input.owner,
    input.repo,
    failedJob.id
  );

  const logExcerpt = rawLog
    ? redactSensitiveLogExcerpt(
        firstActionableLogLine(rawLog) ?? rawLog.slice(-1800),
        900
      )
    : undefined;

  const annotations: string[] = [];
  if (failedStep) {
    annotations.push(`Failed step: ${failedStep.name}`);
  }

  return {
    workflowName: matchingRun.name,
    jobName: failedJob.name,
    failedStep: failedStep?.name,
    annotations,
    logExcerpt,
    logsAvailable: Boolean(logExcerpt),
  };
}
