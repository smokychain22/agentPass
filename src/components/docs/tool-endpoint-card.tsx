"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ToolManifestEntry } from "@/lib/a2mcp/tool-manifest";
import { buildToolCurl } from "@/lib/docs/base-url";
import { CodePanel } from "./code-panel";
import { CopyButton } from "./copy-button";

export function ToolEndpointCard({
  tool,
  baseUrl,
}: {
  tool: ToolManifestEntry;
  baseUrl: string;
}) {
  const curl = buildToolCurl(baseUrl, tool.endpoint, tool.exampleRequest);
  const inputSchema = JSON.stringify(tool.inputSchema, null, 2);
  const sampleRequest = JSON.stringify(tool.exampleRequest, null, 2);
  const sampleResponse = JSON.stringify(tool.exampleResponse, null, 2);

  return (
    <Card id={tool.name} className="border-border/80 scroll-mt-24">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="font-mono text-base">{tool.name}</CardTitle>
          <Badge variant="electric" className="font-mono text-[10px]">
            {tool.method}
          </Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{tool.description}</p>
        <p className="mt-2 font-mono text-xs text-electric/90">{tool.endpoint}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Input schema
          </p>
          <CodePanel code={inputSchema} language="json schema" copyLabel="Copy schema" />
        </div>
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Sample request
          </p>
          <CodePanel code={sampleRequest} copyLabel="Copy JSON" />
        </div>
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Sample response
          </p>
          <CodePanel code={sampleResponse} copyLabel="Copy JSON" />
        </div>
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              curl
            </p>
            <CopyButton text={curl} label="Copy curl" />
          </div>
          <CodePanel code={curl} language="bash" copyLabel="Copy curl" />
        </div>
      </CardContent>
    </Card>
  );
}
