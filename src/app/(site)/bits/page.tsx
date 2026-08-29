import { permanentRedirect } from "next/navigation";
import { PUBLIC_ROUTES } from "@/lib/site-navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function LegacyBitsRedirect() {
  permanentRedirect(PUBLIC_ROUTES.moments);
}
