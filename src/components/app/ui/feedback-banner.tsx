"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type FeedbackVariant = "success" | "error" | "warning" | "info";

interface FeedbackBannerProps {
  variant: FeedbackVariant;
  message: string;
  dismissible?: boolean;
  onDismiss?: () => void;
  className?: string;
}

const styles: Record<FeedbackVariant, { border: string; bg: string; text: string; Icon: typeof Info }> = {
  success: { border: "border-signal/30", bg: "bg-signal/5", text: "text-signal", Icon: CheckCircle2 },
  error: { border: "border-danger/30", bg: "bg-danger/5", text: "text-danger", Icon: AlertCircle },
  warning: { border: "border-warning/30", bg: "bg-warning/5", text: "text-warning", Icon: AlertTriangle },
  info: { border: "border-electric/30", bg: "bg-electric/5", text: "text-electric", Icon: Info },
};

export function FeedbackBanner({
  variant,
  message,
  dismissible = true,
  onDismiss,
  className,
}: FeedbackBannerProps) {
  const { border, bg, text, Icon } = styles[variant];

  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-lg border px-4 py-3", border, bg, className)}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", text)} aria-hidden />
      <p className="flex-1 text-sm text-muted-foreground">{message}</p>
      {dismissible && onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/** Ephemeral toast-style feedback (auto-dismiss) */
export function useFeedbackToast(durationMs = 3000) {
  const [toast, setToast] = useState<{ variant: FeedbackVariant; message: string } | null>(null);

  const show = (variant: FeedbackVariant, message: string) => {
    setToast({ variant, message });
  };

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), durationMs);
    return () => clearTimeout(timer);
  }, [toast, durationMs]);

  const Toast = toast ? (
    <FeedbackBanner
      variant={toast.variant}
      message={toast.message}
      dismissible
      onDismiss={() => setToast(null)}
      className="fixed bottom-4 right-4 z-50 max-w-sm shadow-lg"
    />
  ) : null;

  return { show, Toast };
}
