import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getGroupConstituents } from "@/lib/industry-strength";

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

    const payload = await getGroupConstituents(groupId, {
      page: Number(searchParams.get("page") || "1"),
      limit: Number(searchParams.get("limit") || "50"),
      universe: searchParams.get("universe"),
      search: searchParams.get("search"),
      sortBy: searchParams.get("sortBy"),
      sortDir: searchParams.get("sortDir"),
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
    console.error("Industry Group Constituents API Error:", err);
    return NextResponse.json(
      { error: "Failed to load group constituents" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
