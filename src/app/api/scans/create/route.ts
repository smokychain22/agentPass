import { NextResponse } from "next/server";
import { CreateScanBodySchema } from "@/lib/scanner/types";
import { parseGitHubUrl } from "@/lib/github/parse-github-url";
import { createScanRecord } from "@/lib/scanner/store";

export async function POST(request: Request) {
  try {
    const body = CreateScanBodySchema.parse(await request.json());

    const parsed = parseGitHubUrl(body.url);
    if (!parsed) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Invalid GitHub URL. Use https://github.com/owner/repo or github.com/owner/repo.",
        },
        { status: 400 }
      );
    }

    const record = createScanRecord(
      body.url.trim(),
      body.branch?.trim() || parsed.branch
    );

    return NextResponse.json({
      ok: true,
      data: {
        id: record.id,
        status: record.status,
        url: record.url,
        branch: record.branch,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid request.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
