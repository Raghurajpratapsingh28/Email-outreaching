import { NextResponse } from "next/server";
import { backend, backendErrorResponse } from "@/lib/backend";
import type { HealthResponse } from "@/lib/types";

export async function GET() {
  try {
    const health = await backend.get<HealthResponse>("/health");
    return NextResponse.json(health);
  } catch (err) {
    return backendErrorResponse(err);
  }
}
