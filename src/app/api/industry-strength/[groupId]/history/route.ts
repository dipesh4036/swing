import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getGroupHistory } from "@/lib/industry-strength";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> }
) {
  const user = await requireAuth(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { groupId } = await context.params;
    const { searchParams } = new URL(request.url);

    const payload = await getGroupHistory(groupId, {
      period: searchParams.get("period"),
      universe: searchParams.get("universe"),
    });

    if (!payload) {
      return NextResponse.json(
        { error: `Group '${groupId}' not found` },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (err) {
    console.error("Industry Group History API Error:", err);
    return NextResponse.json(
      { error: "Failed to load group history" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
