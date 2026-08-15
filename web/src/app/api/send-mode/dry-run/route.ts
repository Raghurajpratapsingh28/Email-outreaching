import { NextResponse } from "next/server";
import { backend, backendErrorResponse } from "@/lib/backend";
import type { SendModeStatus } from "@/lib/types";

export async function POST() {
  try {
    const status = await backend.post<SendModeStatus>("/send-mode/dry-run");
    return NextResponse.json(status);
  } catch (err) {
    return backendErrorResponse(err);
  }
}
