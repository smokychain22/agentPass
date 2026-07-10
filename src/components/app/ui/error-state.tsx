"use client";

import { useState } from "react";
import { AlertCircle, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { Panel } from "@/components/design-system/panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ErrorStateAction {
  label: string;
  onClick: () => void;
  variant?: "default" | "secondary" | "outline";
}

interface ErrorStateProps {
  title: string;
  message: string;
  technicalDetail?: string;
  actions?: ErrorStateAction[];
  className?: string;
}

export function ErrorState({
  title,
  message,
  technicalDetail,
  actions = [],
  className,
}: ErrorStateProps) {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <Panel variant="danger" padding="md" className={className} role="alert">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-danger">{title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{message}</p>

          {technicalDetail && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowDetail((v) => !v)}
                className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-foreground"
              >
                {showDetail ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                Technical detail
              </button>
              {showDetail && (
                <pre className="mt-2 overflow-x-auto rounded border border-border/40 bg-[#05080D]/60 p-2 font-mono text-[10px] text-muted-foreground scrollbar-thin">
                  {technicalDetail}
                </pre>
              )}
            </div>
          )}

          {actions.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {actions.map((action) => (
                <Button
                  key={action.label}
                  variant={action.variant ?? (action.label.toLowerCase().includes("retry") ? "default" : "secondary")}
                  size="sm"
                  onClick={action.onClick}
                >
                  {action.label.toLowerCase().includes("retry") && (
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {action.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

/** Map common scan error messages to user-friendly titles */
export function classifyScanError(message: string): { title: string; hint: string } {
  const lower = message.toLowerCase();
  if (lower.includes("private") || lower.includes("404") || lower.includes("not found")) {
    return {
      title: "Repository not found",
      hint: "Confirm the URL is correct and the repository is public on GitHub.",
    };
  }
  if (lower.includes("branch")) {
    return { title: "Branch not found", hint: "Check the branch name or leave it empty for the default branch." };
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return { title: "Scan timeout", hint: "The repository may be too large. Try again or use a smaller public repo." };
  }
  if (lower.includes("rate limit")) {
    return { title: "Rate limit reached", hint: "Wait a moment and retry, or try the demo repository." };
  }
  if (lower.includes("valid") || lower.includes("github")) {
    return {
      title: "Invalid GitHub URL",
      hint: "Enter a public GitHub repository URL like https://github.com/owner/repo.",
    };
  }
  if (lower.includes("download") || lower.includes("archive") || lower.includes("fetch")) {
    return {
      title: "Archive download failed",
      hint: "GitHub may be unavailable or the repository archive could not be retrieved.",
    };
  }
  return { title: "Scan failed", hint: "Review the repository URL and try again." };
}
