import { startConnect } from "@/lib/social/connect";

export async function GET() {
  return startConnect("FACEBOOK");
}
