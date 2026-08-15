import { NextRequest, NextResponse } from "next/server";
import { backend, backendErrorResponse } from "@/lib/backend";
import type { StartCampaignResult } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const result = await backend.post<StartCampaignResult>(
      `/campaigns/${id}/resume`,
    );
    return NextResponse.json(result);
  } catch (err) {
    return backendErrorResponse(err);
  }
}
