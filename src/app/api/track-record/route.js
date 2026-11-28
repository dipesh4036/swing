import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getTrackRecordData, parseTrackRecordParams } from "@/lib/track-record";

export async function GET(request) {
  const user = await requireAuth(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const parsed = parseTrackRecordParams(searchParams);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.error },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const data = await getTrackRecordData(parsed.params);
    return NextResponse.json(data, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("Error in GET /api/track-record:", err);
    return NextResponse.json(
      { error: "Failed to load Track Record" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
