import { NextResponse } from "next/server";

import { getReadiness } from "@/server/health";

export async function GET() {
  const summary = await getReadiness();

  return NextResponse.json(summary, {
    status: summary.ok ? 200 : 503,
  });
}
