import { NextRequest, NextResponse } from "next/server";
import { backend, backendErrorResponse } from "@/lib/backend";
import type { CampaignPreviewItem, ContactPreview } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

// GET → preview N matching recipients (nothing queued).
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const limit = request.nextUrl.searchParams.get("limit") ?? "5";
    const items = await backend.get<CampaignPreviewItem[]>(
      `/campaigns/${id}/preview?limit=${encodeURIComponent(limit)}`,
    );
    return NextResponse.json(items);
  } catch (err) {
    return backendErrorResponse(err);
  }
}

// POST { contactId } → the exact email one specific contact would receive.
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = await request.json();
    const preview = await backend.post<ContactPreview>(
      `/campaigns/${id}/preview`,
      body,
    );
    return NextResponse.json(preview);
  } catch (err) {
    return backendErrorResponse(err);
  }
}
