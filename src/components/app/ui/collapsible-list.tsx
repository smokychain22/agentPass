"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const DEFAULT_VISIBLE = 6;

interface CollapsibleFileListProps {
  files: string[];
  visibleCount?: number;
  className?: string;
  itemClassName?: string;
  emptyLabel?: string;
}

export function CollapsibleFileList({
  files,
  visibleCount = DEFAULT_VISIBLE,
  className,
  itemClassName,
  emptyLabel = "—",
}: CollapsibleFileListProps) {
  const [expanded, setExpanded] = useState(false);

  if (files.length === 0) {
    return <span className={cn("text-muted-foreground", className)}>{emptyLabel}</span>;
  }

  const hiddenCount = Math.max(0, files.length - visibleCount);
  const visible = expanded ? files : files.slice(0, visibleCount);

  return (
    <div className={className}>
      <ul className="space-y-0.5">
        {visible.map((file) => (
          <li key={file} className={cn("font-mono text-xs text-muted-foreground", itemClassName)}>
            {file}
          </li>
        ))}
      </ul>
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1.5 text-xs text-electric hover:underline"
        >
          {expanded ? "Show less" : `Show ${hiddenCount} more`}
        </button>
      )}
    </div>
  );
}

interface CollapsibleTableProps<T> {
  items: T[];
  visibleCount?: number;
  renderRow: (item: T, index: number) => ReactNode;
  rowKey: (item: T, index: number) => string;
  emptyMessage?: string;
}

export function CollapsibleTableBody<T>({
  items,
  visibleCount = DEFAULT_VISIBLE,
  renderRow,
  rowKey,
  emptyMessage,
}: CollapsibleTableProps<T>) {
  const [expanded, setExpanded] = useState(false);

  if (items.length === 0) {
    return (
      <tbody>
        <tr>
          <td colSpan={99} className="px-3 py-4 text-sm text-muted-foreground">
            {emptyMessage ?? "No items."}
          </td>
        </tr>
      </tbody>
    );
  }

  const hiddenCount = Math.max(0, items.length - visibleCount);
  const visible = expanded ? items : items.slice(0, visibleCount);

  return (
    <>
      <tbody>
        {visible.map((item, index) => (
          <tr key={rowKey(item, index)}>{renderRow(item, index)}</tr>
        ))}
      </tbody>
      {hiddenCount > 0 && (
        <tbody>
          <tr>
            <td colSpan={99} className="px-3 py-2">
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="text-xs text-electric hover:underline"
              >
                {expanded ? "Show less" : `Show ${hiddenCount} more`}
              </button>
            </td>
          </tr>
        </tbody>
      )}
    </>
  );
}
