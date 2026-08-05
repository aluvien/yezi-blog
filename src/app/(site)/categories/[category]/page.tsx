import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { countApprovedCommentsBulk, listPostsByCategory } from "@/lib/db";
import { PostEntry } from "@/components/site/PostEntry";

type Props = { params: Promise<{ category: string }> };
function decode(value: string) { try { return decodeURIComponent(value).trim(); } catch { return value.trim(); } }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const category = decode((await params).category);
  return { title: `分类：${category}` };
}

export default async function CategoryPage({ params }: Props) {
  const category = decode((await params).category);
  if (!category) notFound();
  const posts = listPostsByCategory(category);
  const commentCounts = countApprovedCommentsBulk("post", posts.map((post) => post.id));
  return <div className="mx-auto max-w-[860px] py-8 md:py-12">
    <Link href="/archives" className="text-[13px] text-wechat-blue hover:text-accent">← 返回归档</Link>
    <header className="site-page-header mt-8 border-b border-divider pb-7">
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-accent">Category archive</p>
      <h1 className="mt-3 text-[30px] font-semibold tracking-[-0.04em] md:text-[40px]">{category}</h1>
      <p className="mt-3 text-[14px] text-muted">共 {posts.length} 篇文章</p>
    </header>
    {posts.length === 0 ? <p className="py-16 text-center text-[14px] text-muted">这个分类下暂时没有文章。</p> : <div className="divide-y divide-divider">{posts.map((post) => <div key={post.id} className="py-6"><PostEntry post={post} commentCount={commentCounts.get(post.id) ?? 0} /></div>)}</div>}
  </div>;
}
