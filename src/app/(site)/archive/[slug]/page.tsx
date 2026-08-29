import { permanentRedirect } from "next/navigation";
import { PUBLIC_ROUTES } from "@/lib/site-navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

/** 旧的归档文章地址保留为兼容入口，文章规范地址统一归入“随笔”。 */
export default async function ArchivePostRedirect({ params }: Props) {
  const { slug } = await params;
  permanentRedirect(PUBLIC_ROUTES.post(slug));
}
