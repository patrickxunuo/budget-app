import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { processAuthDeletionQueue } from "@/lib/auth/deletion-queue";
import { getServerEnv } from "@/lib/env/server";

function authorized(request: NextRequest) {
  const supplied = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${getServerEnv().CRON_SECRET}`;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: NextRequest) {
  if (!authorized(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await processAuthDeletionQueue();
  return NextResponse.json(result, { status: result.failed ? 503 : 200 });
}
