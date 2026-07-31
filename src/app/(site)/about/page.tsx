import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/lib/site";
import { PageHeader } from "@/components/site/PageHeader";

export const metadata: Metadata = {
  title: "关于",
  description: `关于 ${site.author}`,
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-[860px] py-8 md:py-12">
      <PageHeader
        eyebrow="About the author"
        title={`你好，我是 ${site.author}。`}
        description="写代码，也写字。相信清晰的表达，和好产品一样，能让复杂的事变得简单。"
      />

      <section className="paper-card rounded-2xl px-5 py-7 md:px-9 md:py-9">
        <div className="grid gap-9 md:grid-cols-[1fr_230px] md:gap-12">
          <div className="space-y-6 text-[16px] leading-8 text-foreground/80">
            <p>这里是我的个人数字花园。长文章记录完整的思考，想法页保存尚未长大的念头，作品页则收纳那些真正动手做出来的东西。</p>
            <p>我不追求每天更新，只希望每一篇内容都经得起重读。比起快速给出答案，我更在意问题为什么值得被问，以及一件事能不能讲得足够清楚。</p>
            <blockquote className="border-l-3 border-accent bg-[#f5fbf8] px-5 py-4 text-[15px] leading-7 text-foreground/70">把经验写下来，是给未来的自己留一条回来的路。</blockquote>
          </div>
          <aside className="space-y-7 border-t border-divider pt-8 md:border-l md:border-t-0 md:pl-8 md:pt-0">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-[18px] font-bold text-white">{site.author.charAt(0).toUpperCase()}</div>
            <div><p className="text-[11px] uppercase tracking-[0.18em] text-muted">正在关注</p><p className="mt-2 text-[14px] leading-6">产品设计、软件工程、个人创作与日常观察</p></div>
            <div><p className="text-[11px] uppercase tracking-[0.18em] text-muted">写作原则</p><p className="mt-2 text-[14px] leading-6">真诚、具体、有用，也允许保留一点未完成</p></div>
            <Link href="/" className="inline-flex items-center gap-2 text-[14px] font-medium text-wechat-blue">从最新文章开始 <span>→</span></Link>
          </aside>
        </div>
      </section>
    </div>
  );
}
