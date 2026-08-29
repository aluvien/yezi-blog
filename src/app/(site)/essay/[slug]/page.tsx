import { permanentRedirect } from "next/navigation";
import { PUBLIC_ROUTES } from "@/lib/site-navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export default async function LegacyEssayPostRedirect({ params }: Props) {
  permanentRedirect(PUBLIC_ROUTES.post((await params).slug));
}
