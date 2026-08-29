import { permanentRedirect } from "next/navigation";
import { PUBLIC_ROUTES } from "@/lib/site-navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LegacyEssayRedirect({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const page = (await searchParams).page;
  permanentRedirect(page ? `${PUBLIC_ROUTES.posts}?page=${encodeURIComponent(page)}` : PUBLIC_ROUTES.posts);
}
