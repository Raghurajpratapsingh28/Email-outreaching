import { NextRequest, NextResponse } from "next/server";
import { backend, backendErrorResponse } from "@/lib/backend";
import type { Contact } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const contact = await backend.get<Contact>(`/contacts/${id}`);
    return NextResponse.json(contact);
  } catch (err) {
    return backendErrorResponse(err);
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = await request.json();
    const contact = await backend.patch<Contact>(`/contacts/${id}`, body);
    return NextResponse.json(contact);
  } catch (err) {
    return backendErrorResponse(err);
  }
}
