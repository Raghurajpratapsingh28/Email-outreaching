import { NextRequest, NextResponse } from "next/server";
import { backend, backendErrorResponse } from "@/lib/backend";
import type { ImportResult } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    // Pass the multipart form straight through — the backend expects a
    // "file" field containing the PDF.
    const form = await request.formData();
    const result = await backend.postForm<ImportResult>(
      "/contacts/import",
      form,
    );
    return NextResponse.json(result);
  } catch (err) {
    return backendErrorResponse(err);
  }
}
