"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateSiteSettingsAction } from "@/lib/actions/settings";
import { DARK_MODE_OPTIONS, LAYOUT_THEMES, THEME_PALETTES } from "@/lib/theme";
import ImageUpload from "./ImageUpload";
import QQMusicPanel from "./QQMusicPanel";

type Props = { initialValues: Record<string, string> };

export default function SiteSettingsForm({ initialValues }: Props) {
  const router = useRouter();
  const [values, setValues] = useState({
    site_name: initialValues.site_name ?? "",
    site_subtitle: initialValues.site_subtitle ?? "",
    site_logo: initialValues.site_logo ?? "",
    site_logo_no_border: initialValues.site_logo_no_border ?? "0",
    footer_text: initialValues.footer_text ?? "",
    social_links: initialValues.social_links ?? "",
    show_related_posts: initialValues.show_related_posts ?? "1",
    show_more_posts: initialValues.show_more_posts ?? "1",
    show_table_of_contents: initialValues.show_table_of_contents ?? "1",
    author_name: initialValues.author_name ?? "",
    author_email: initialValues.author_email ?? "",
    gravatar_mirror: initialValues.gravatar_mirror ?? "",
    author_avatar: initialValues.author_avatar ?? "",
    author_avatar_no_border: initialValues.author_avatar_no_border ?? "0",
    about_content: initialValues.about_content ?? "",
    meting_api: initialValues.meting_api ?? "",
    default_music: initialValues.default_music ?? "",
    default_music_shuffle: initialValues.default_music_shuffle ?? "0",
    music_float_enabled: initialValues.music_float_enabled ?? "1",
    music_position: initialValues.music_position ?? "left",
    theme: initialValues.theme ?? "default",
    layout_theme: initialValues.layout_theme ?? "classic",
    dark_mode: initialValues.dark_mode ?? "auto",
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function update(key: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    setError("");
    startTransition(async () => {
      const result = await updateSiteSettingsAction(values);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage("设置已保存");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-12">
      <section className="rounded-2xl bg-white p-5 shadow-sm xl:col-span-5 sm:p-6">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-neutral-800">站点信息</h2>
          <p className="mt-1 text-xs text-neutral-500">设置网站名称、副标题和页脚显示内容。</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-700">站点名称</label>
          <input value={values.site_name} onChange={(event) => update("site_name", event.target.value)} className="w-full rounded-lg border border-neutral-300 px-3 py-2" placeholder="Yezi's Blog" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-700">站点副标题</label>
          <input value={values.site_subtitle} onChange={(event) => update("site_subtitle", event.target.value)} className="w-full rounded-lg border border-neutral-300 px-3 py-2" placeholder="文章 · 想法 · 作品" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-700">页脚文案</label>
          <input value={values.footer_text} onChange={(event) => update("footer_text", event.target.value)} className="w-full rounded-lg border border-neutral-300 px-3 py-2" placeholder="认真写字，也认真生活。" />
        </div>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-sm xl:col-span-7 xl:row-span-2 sm:p-6">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-neutral-800">个人资料与品牌</h2>
          <p className="mt-1 text-xs text-neutral-500">这些内容会显示在前台页头、想法、文章和作者卡片中。</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
        <div className="rounded-xl border-2 border-accent/25 bg-accent/5 p-4">
          <label className="mb-1 block text-sm font-semibold text-neutral-800">前台作者名称</label>
          <input value={values.author_name} onChange={(event) => update("author_name", event.target.value)} className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2" placeholder="例如：Yezi" />
          <p className="mt-1.5 text-xs text-neutral-500">会显示在首页、想法、文章页、评论和作者卡片中；留空时使用默认名称 Yezi。</p>
        </div>
        <div>
          <ImageUpload value={values.site_logo || null} onChange={(path) => update("site_logo", path ?? "")} label="站点 Logo（可选）" contain />
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-neutral-500">
            <input
              type="checkbox"
              checked={values.site_logo_no_border === "1"}
              onChange={(event) => update("site_logo_no_border", event.target.checked ? "1" : "0")}
              className="h-3.5 w-3.5 accent-neutral-700"
            />
            隐藏 Logo 图片边框
          </label>
        </div>

        </div>
        <div className="space-y-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
          <p className="text-sm font-medium text-neutral-700">头像与 Gravatar</p>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-neutral-600">作者邮箱（用于 Gravatar 默认头像）</label>
              <input value={values.author_email} onChange={(event) => update("author_email", event.target.value)} className="w-full rounded-lg border border-neutral-300 px-3 py-2" placeholder="you@example.com" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-600">Gravatar 镜像地址（留空用官方）</label>
              <input value={values.gravatar_mirror} onChange={(event) => update("gravatar_mirror", event.target.value)} className="w-full rounded-lg border border-neutral-300 px-3 py-2" placeholder="https://secure.gravatar.com" />
            </div>
          </div>
          <ImageUpload value={values.author_avatar || null} onChange={(path) => update("author_avatar", path ?? "")} label="自定义头像（上传后优先于 Gravatar）" />
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-neutral-500">
            <input
              type="checkbox"
              checked={values.author_avatar_no_border === "1"}
              onChange={(event) => update("author_avatar_no_border", event.target.checked ? "1" : "0")}
              className="h-3.5 w-3.5 accent-neutral-700"
            />
            隐藏头像图片边框
          </label>
        </div>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-sm xl:col-span-5 sm:p-6">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-neutral-800">社交与关于</h2>
          <p className="mt-1 text-xs text-neutral-500">配置个人链接和关于页的 Markdown 内容。</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-700">社交链接（每行：名称 | URL）</label>
          <textarea value={values.social_links} onChange={(event) => update("social_links", event.target.value)} rows={5} className="w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-sm" placeholder="GitHub | https://github.com/..." />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-700">关于页内容（Markdown，留空用默认）</label>
          <textarea value={values.about_content} onChange={(event) => update("about_content", event.target.value)} rows={5} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm leading-6" placeholder="支持 Markdown 语法，留空显示默认关于页。" />
        </div>
        </div>
      </section>
      </div>

      <section className="space-y-5 rounded-2xl bg-white p-5 shadow-sm sm:p-6">
        <div>
        <div>
          <h2 className="text-base font-semibold text-neutral-800">音乐设置</h2>
          <p className="mt-1 text-xs text-neutral-500">配置音乐接口、默认歌单和前台播放器入口。</p>
        </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
        <div>
        <label className="mb-1 block text-sm font-medium text-neutral-700">音乐 API 地址（留空用默认）</label>
        <input value={values.meting_api} onChange={(event) => update("meting_api", event.target.value)} className="w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-sm" placeholder="https://api.injahow.cn/meting/" />
        <p className="mt-1 text-xs text-neutral-400">用于文章/想法内嵌音乐。默认公共接口可能不稳定，建议自建 Meting API 或换镜像。</p>
        </div>
        <div>
        <label className="mb-1 block text-sm font-medium text-neutral-700">默认音乐列表（形如 netease:数字:playlist，留空不预置）</label>
        <input value={values.default_music} onChange={(event) => update("default_music", event.target.value)} className="w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-sm" placeholder="netease:7785232779:playlist" />
        <p className="mt-1 text-xs text-neutral-400">格式 <code>server:id:type</code>（server: netease/qq/kugou/kuwo/xiami/baidu；type: song/playlist/album/search）。QQ 登录搜索的单曲会自动插入为 <code>qqvip:歌曲MID:song</code>；也可在末尾加 <code>:random</code>。全站加载后作为全局播放器的基础列表，页面点选的音乐追加其后。</p>
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-neutral-500">
          <input
            type="checkbox"
            checked={values.default_music_shuffle === "1"}
            onChange={(event) => update("default_music_shuffle", event.target.checked ? "1" : "0")}
            className="h-3.5 w-3.5 accent-neutral-700"
          />
          随机播放默认歌单
        </label>
        </div>
        </div>

        <QQMusicPanel />

        <div className="grid gap-4 md:grid-cols-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={values.music_float_enabled === "1"}
            onChange={(event) => update("music_float_enabled", event.target.checked ? "1" : "0")}
            className="h-4 w-4 accent-neutral-700"
          />
          显示音乐图标按钮
        </label>
        <div className="text-sm text-neutral-700">
          <p>音乐图标/播放器位置</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {[
              ["left", "左下角"],
              ["right", "右下角"],
              ["bottom", "底部展开播放器"],
            ].map(([value, label]) => (
              <label key={value} className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${values.music_position === value ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-600 hover:border-neutral-500"}`}>
                <input type="radio" name="music-position" value={value} checked={values.music_position === value} onChange={(event) => update("music_position", event.target.value)} className="h-3.5 w-3.5 accent-current" />
                {label}
              </label>
            ))}
          </div>
        </div>
        <p className="text-xs text-neutral-400 md:col-span-2">关闭图标按钮后，播放器仍可由文章音乐触发；选择“底部展开播放器”时不显示悬浮图标，播放器面板会固定展开在页面底部。</p>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-12">
      <fieldset className="space-y-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 xl:col-span-8 sm:p-5">
        <legend className="px-1 text-sm font-medium text-neutral-700">外观主题</legend>
        <div>
          <p className="text-sm text-neutral-600">前台版式主题（不改变现有内容与数据）</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {LAYOUT_THEMES.map((layout) => {
              const selected = values.layout_theme === layout.id;
              return (
                <button
                  key={layout.id}
                  type="button"
                  onClick={() => update("layout_theme", layout.id)}
                  aria-pressed={selected}
                  className={`flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-colors ${
                    selected ? "border-neutral-900 bg-white ring-2 ring-neutral-900/10" : "border-neutral-200 hover:border-neutral-400"
                  }`}
                >
                  <span className="text-sm font-medium text-neutral-800">{layout.name}</span>
                  <span className="text-xs leading-5 text-neutral-500">{layout.description}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <p className="text-sm text-neutral-600">配色方案（保存后前台立即生效）</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {THEME_PALETTES.map((palette) => {
              const selected = values.theme === palette.id;
              return (
                <button
                  key={palette.id}
                  type="button"
                  onClick={() => update("theme", palette.id)}
                  aria-pressed={selected}
                  className={`flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-colors ${
                    selected ? "border-neutral-900 ring-2 ring-neutral-900/10" : "border-neutral-200 hover:border-neutral-400"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="flex h-7 w-12 items-center justify-center rounded-md border border-neutral-200" style={{ background: palette.lightBackground }}>
                      <span className="h-3 w-3 rounded-full" style={{ background: palette.lightAccent }} />
                    </span>
                    <span className="flex h-7 w-12 items-center justify-center rounded-md border border-neutral-700" style={{ background: palette.darkBackground }}>
                      <span className="h-3 w-3 rounded-full" style={{ background: palette.darkAccent }} />
                    </span>
                  </span>
                  <span className="text-sm font-medium text-neutral-800">{palette.name}</span>
                  <span className="text-xs leading-5 text-neutral-500">{palette.description}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <p className="text-sm text-neutral-600">深色模式（访客可在前台页头手动切换）</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {DARK_MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => update("dark_mode", option.value)}
                aria-pressed={values.dark_mode === option.value}
                title={option.description}
                className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                  values.dark_mode === option.value ? "bg-neutral-900 text-white" : "border border-neutral-300 text-neutral-600 hover:bg-neutral-100"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 xl:col-span-4 xl:self-start sm:p-5">
        <legend className="px-1 text-sm font-medium text-neutral-700">文章与列表显示</legend>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="flex cursor-pointer items-center gap-3 text-sm text-neutral-700">
            <input type="checkbox" checked={values.show_related_posts !== "0"} onChange={(event) => update("show_related_posts", event.target.checked ? "1" : "0")} className="h-4 w-4 accent-accent" />
            显示文章页“继续阅读”
          </label>
          <label className="flex cursor-pointer items-center gap-3 text-sm text-neutral-700">
            <input type="checkbox" checked={values.show_more_posts !== "0"} onChange={(event) => update("show_more_posts", event.target.checked ? "1" : "0")} className="h-4 w-4 accent-accent" />
            显示文章列表页“查看更多文章”
          </label>
          <label className="flex cursor-pointer items-center gap-3 text-sm text-neutral-700">
            <input type="checkbox" checked={values.show_table_of_contents !== "0"} onChange={(event) => update("show_table_of_contents", event.target.checked ? "1" : "0")} className="h-4 w-4 accent-accent" />
            显示文章右侧目录
          </label>
        </div>
      </fieldset>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">{pending ? "保存中…" : "保存设置"}</button>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {message && <p className="text-sm text-green-600">{message}</p>}
      </div>
    </form>
  );
}
