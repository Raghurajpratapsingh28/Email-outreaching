import { NextRequest, NextResponse } from "next/server";
import { backend, backendErrorResponse } from "@/lib/backend";
import type { ContactPreview } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = await request.json();
    const preview = await backend.post<
      ContactPreview & { to: string; contact: string }
    >(`/templates/${id}/preview`, body);
    return NextResponse.json(preview);
  } catch (err) {
    return backendErrorResponse(err);
  }
}
