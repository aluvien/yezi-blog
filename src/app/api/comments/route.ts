import { NextResponse } from "next/server";
import { submitComment } from "@/lib/comment-api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const result = await submitComment(request);
  return NextResponse.json(result.data, { status: result.status });
}
