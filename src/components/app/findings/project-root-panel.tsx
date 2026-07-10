"use client";

import { Panel } from "@/components/design-system/panel";
import type { FindingsPayload } from "@/lib/findings/types";

export function ProjectRootPanel({ payload }: { payload: FindingsPayload }) {
  const model = payload.repositoryModel;
  if (!model?.projects?.length) return null;

  const projects = model.projects as Array<{
    packageName?: string;
    projectRoot?: string;
    framework?: string;
    role?: string;
  }>;

  return (
    <Panel variant="elevated" padding="md">
      <p className="ds-label mb-3">Project roots</p>
      <p className="mb-4 text-sm text-muted-foreground">
        RepoDiet analyzed{" "}
        <span className="font-mono text-foreground">{model.primaryProjectRoot || "."}</span> as the
        primary application root
        {projects.length > 1 ? " and excluded mirrored nested copies from actionable counts." : "."}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border/40 text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-4">Root</th>
              <th className="py-2 pr-4">Framework</th>
              <th className="py-2 pr-4">Role</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={String(p.projectRoot)} className="border-b border-border/20">
                <td className="py-2 pr-4 font-mono text-xs">{p.projectRoot || "."}</td>
                <td className="py-2 pr-4">{p.framework ?? "unknown"}</td>
                <td className="py-2 pr-4">
                  {p.projectRoot === model.primaryProjectRoot || (!p.projectRoot && model.primaryProjectRoot === ".")
                    ? "primary (selected)"
                    : (p.role ?? "unknown")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
