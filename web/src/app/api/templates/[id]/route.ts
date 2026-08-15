import { NextRequest, NextResponse } from "next/server";
import { backend, backendErrorResponse } from "@/lib/backend";
import type { EmailTemplate } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const template = await backend.get<EmailTemplate>(`/templates/${id}`);
    return NextResponse.json(template);
  } catch (err) {
    return backendErrorResponse(err);
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = await request.json();
    const template = await backend.patch<EmailTemplate>(`/templates/${id}`, body);
    return NextResponse.json(template);
  } catch (err) {
    return backendErrorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    await backend.delete(`/templates/${id}`);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return backendErrorResponse(err);
  }
}
