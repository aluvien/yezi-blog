import { NextResponse } from "next/server";
import { logout } from "@/lib/auth";
import { validateSameOriginWrite } from "@/lib/request-security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rejection = validateSameOriginWrite(request, { requireCsrfHeader: true });
  if (rejection) return NextResponse.json({ error: rejection.message }, { status: rejection.status });
  await logout();
  return NextResponse.json({ ok: true });
}
