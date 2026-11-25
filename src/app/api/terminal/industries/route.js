import { NextResponse } from "next/server";
import { queryWithRetry } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { buildIndustriesPayload } from "@/lib/industries-data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request) {
  const user = await requireAuth(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const indFilter = searchParams.get("industry");

  try {
    const payload = await buildIndustriesPayload(queryWithRetry, { industry: indFilter });
    return NextResponse.json(payload);
  } catch (err) {
    console.error("Industries API Error:", err);
    return NextResponse.json(
      { error: "Internal server error fetching industry rotation data" },
      { status: 500 }
    );
  }
}
