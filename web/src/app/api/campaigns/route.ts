import { NextRequest, NextResponse } from "next/server";
import { backend, backendErrorResponse } from "@/lib/backend";
import type { Campaign } from "@/lib/types";

export async function GET() {
  try {
    const campaigns = await backend.get<Campaign[]>("/campaigns");
    return NextResponse.json(campaigns);
  } catch (err) {
    return backendErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const campaign = await backend.post<Campaign>("/campaigns", body);
    return NextResponse.json(campaign, { status: 201 });
  } catch (err) {
    return backendErrorResponse(err);
  }
}
