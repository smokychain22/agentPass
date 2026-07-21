import { createVerifyOnlyDiagnosticRoute } from "@/lib/payment/a2mcp-verify-only-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = createVerifyOnlyDiagnosticRoute();
