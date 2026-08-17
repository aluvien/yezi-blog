import { apiJson, apiOptions, publicArticleReferenceSnapshot, publicPost } from "@/lib/api";
import { getContentMetrics, getPostBySlug, listApprovedComments, listArticleReferenceSnapshotsForPost } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return apiJson({ error: "文章不存在" }, 404);
  const comments = listApprovedComments("post", post.id);
  return apiJson({
    data: {
      ...publicPost(post, comments),
      metrics: getContentMetrics("post", post.id),
      // Markdown 内的 !reference:<token> 由这些公开快照解析；私有阅读归档不在 API 中返回。
      references: listArticleReferenceSnapshotsForPost(post.id).map(publicArticleReferenceSnapshot),
    },
  });
}

export function OPTIONS() {
  return apiOptions();
}
