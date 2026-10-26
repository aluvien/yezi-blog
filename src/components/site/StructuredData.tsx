import { headers } from "next/headers";
import { serializeJsonLd } from "@/lib/seo";

export async function StructuredData({ data }: { data: unknown }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
