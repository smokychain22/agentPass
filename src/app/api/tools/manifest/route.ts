import { NextResponse } from "next/server";
import { buildServiceManifest, TOOL_MANIFEST_ENTRIES } from "@/lib/a2mcp/tool-manifest";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    {
      ...buildServiceManifest(),
      examples: TOOL_MANIFEST_ENTRIES.map((tool) => ({
        name: tool.name,
        exampleRequest: tool.exampleRequest,
        exampleResponse: tool.exampleResponse,
      })),
    },
    { headers: { "Content-Type": "application/json" } }
  );
}
