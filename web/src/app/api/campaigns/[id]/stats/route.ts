import { NextRequest, NextResponse } from "next/server";
import { backend, backendErrorResponse } from "@/lib/backend";
import type { CampaignStats } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const stats = await backend.get<CampaignStats>(`/campaigns/${id}/stats`);
    return NextResponse.json(stats);
  } catch (err) {
    return backendErrorResponse(err);
  }
}
