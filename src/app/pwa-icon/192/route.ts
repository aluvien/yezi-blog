import { renderPwaIcon } from "@/lib/pwa-icon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const icon = await renderPwaIcon(192);
  return new Response(new Uint8Array(icon), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
    },
  });
}
