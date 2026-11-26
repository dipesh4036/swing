import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getRankings } from "@/lib/industry-strength";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const user = await requireAuth(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const payload = await getRankings({
      level: searchParams.get("level"),
      period: searchParams.get("period"),
      universe: searchParams.get("universe"),
      parentId: searchParams.get("parentId"),
      search: searchParams.get("search"),
      sortBy: searchParams.get("sortBy"),
      sortDir: searchParams.get("sortDir"),
      showSmall: searchParams.get("showSmall") === "true",
    });

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": payload.snapshotId ? "private, max-age=300" : "no-store",
      },
    });
  } catch (err) {
    console.error("Industry Strength API Error:", err);
    return NextResponse.json(
      { error: "Failed to load industry strength rankings" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
