import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getDailyPlan, isValidPlanDateParam } from "@/lib/daily-plan";

export async function GET(request) {
  const user = await requireAuth(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date");

    if (!isValidPlanDateParam(dateParam)) {
      return NextResponse.json(
        { error: "Invalid date parameter. Expected YYYY-MM-DD." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const plan = await getDailyPlan(dateParam);
    if (!plan) {
      return NextResponse.json(
        { error: dateParam ? `No Daily Plan found for ${dateParam}.` : "No Daily Plan available yet." },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json(plan, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("Error in GET /api/plan:", err);
    return NextResponse.json(
      { error: "Failed to load Daily Plan" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
