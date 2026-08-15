import { NextRequest, NextResponse } from "next/server";
import { backend, backendErrorResponse } from "@/lib/backend";
import type { ContactListResponse } from "@/lib/types";

export async function GET(request: NextRequest) {
  try {
    const qs = request.nextUrl.search;
    const data = await backend.get<ContactListResponse>(`/contacts${qs}`);
    return NextResponse.json(data);
  } catch (err) {
    return backendErrorResponse(err);
  }
}
