import { NextRequest, NextResponse } from "next/server";
import { backend, backendErrorResponse } from "@/lib/backend";
import type { EmailTemplate } from "@/lib/types";

export async function GET() {
  try {
    const templates = await backend.get<EmailTemplate[]>("/templates");
    return NextResponse.json(templates);
  } catch (err) {
    return backendErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const template = await backend.post<EmailTemplate>("/templates", body);
    return NextResponse.json(template, { status: 201 });
  } catch (err) {
    return backendErrorResponse(err);
  }
}
