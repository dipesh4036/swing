import { NextResponse } from "next/server";
import { getDataTrustChip, getDataTrustData } from "@/lib/data-trust";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    if (searchParams.get("chip") === "1") {
      const chip = await getDataTrustChip();
      return NextResponse.json({ chip });
    }
    const payload = await getDataTrustData();
    return NextResponse.json(payload);
  } catch (err) {
    console.error("Error in GET /api/data-trust:", err);
    return NextResponse.json(
      { error: "Failed to load Data Trust status" },
      { status: 500 }
    );
  }
}
