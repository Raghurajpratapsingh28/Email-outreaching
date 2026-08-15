import { NextRequest, NextResponse } from "next/server";
import { backend, backendErrorResponse } from "@/lib/backend";
import type { SendModeStatus } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const status = await backend.post<SendModeStatus>("/send-mode/live", body);
    return NextResponse.json(status);
  } catch (err) {
    return backendErrorResponse(err);
  }
}
