import { notFound, redirect } from "next/navigation";
import { getPublishedPostByShortCode } from "@/lib/db";
import { PUBLIC_ROUTES } from "@/lib/site-navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ShortLinkPage({ params }: { params: Promise<{ shortCode: string }> }) {
  const { shortCode } = await params;
  if (!/^[A-Za-z0-9]{8}$/.test(shortCode)) notFound();
  const post = getPublishedPostByShortCode(shortCode);
  if (!post) notFound();
  redirect(`${PUBLIC_ROUTES.post(post.slug)}?reading=1`);
}
