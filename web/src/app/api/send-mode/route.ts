import { NextResponse } from "next/server";
import { backend, backendErrorResponse } from "@/lib/backend";
import type { SendModeStatus } from "@/lib/types";

export async function GET() {
  try {
    const status = await backend.get<SendModeStatus>("/send-mode");
    return NextResponse.json(status);
  } catch (err) {
    return backendErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const status = await backend.delete<SendModeStatus>("/send-mode");
    return NextResponse.json(status);
  } catch (err) {
    return backendErrorResponse(err);
  }
}
