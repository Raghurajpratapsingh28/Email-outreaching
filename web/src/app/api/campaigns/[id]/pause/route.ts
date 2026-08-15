import { NextRequest, NextResponse } from "next/server";
import { backend, backendErrorResponse } from "@/lib/backend";
import type { Campaign } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const campaign = await backend.post<Campaign>(`/campaigns/${id}/pause`);
    return NextResponse.json(campaign);
  } catch (err) {
    return backendErrorResponse(err);
  }
}
