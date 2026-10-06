import type { NextRequest } from "next/server";
import { finishConnect } from "@/lib/social/connect";

export async function GET(request: NextRequest) {
  return finishConnect("YOUTUBE", request.nextUrl.searchParams);
}
