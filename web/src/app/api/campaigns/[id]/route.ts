import { NextRequest, NextResponse } from "next/server";
import { backend, backendErrorResponse } from "@/lib/backend";
import type { Campaign } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

// The backend has no GET /campaigns/:id — derive it from the list endpoint
// so the frontend can still route to /campaigns/[id] cleanly.
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const campaigns = await backend.get<Campaign[]>("/campaigns");
    const campaign = campaigns.find((c) => String(c.id) === id);
    if (!campaign) {
      return NextResponse.json({ error: "campaign not found" }, { status: 404 });
    }
    return NextResponse.json(campaign);
  } catch (err) {
    return backendErrorResponse(err);
  }
}
