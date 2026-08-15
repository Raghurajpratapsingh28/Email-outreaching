import { NextRequest, NextResponse } from "next/server";
import { backend, backendErrorResponse } from "@/lib/backend";
import type { SuppressionEntry } from "@/lib/types";

export async function GET() {
  try {
    const entries = await backend.get<SuppressionEntry[]>("/suppression");
    return NextResponse.json(entries);
  } catch (err) {
    return backendErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const entry = await backend.post<SuppressionEntry>("/suppression", body);
    return NextResponse.json(entry, { status: 201 });
  } catch (err) {
    return backendErrorResponse(err);
  }
}
