"use client";

export type MarkdownTool =
  | { kind: "line-prefix"; label: string; title: string; prefix: string; placeholder: string }
  | { kind: "wrap"; label: string; title: string; before: string; after: string; placeholder: string }
  | { kind: "link" | "image" | "gallery" | "music" | "video" | "reference"; label: string; title: string }
  | { kind: "raw"; label: string; title: string; text: string };

const H2_TOOL = { kind: "line-prefix", label: "H2", title: "将选中行设为二级标题", prefix: "## ", placeholder: "小标题" } as const;
const BOLD_TOOL = { kind: "wrap", label: "粗体", title: "将选中文字设为粗体", before: "**", after: "**", placeholder: "重点文字" } as const;
const ITALIC_TOOL = { kind: "wrap", label: "斜体", title: "将选中文字设为斜体", before: "*", after: "*", placeholder: "强调文字" } as const;
const LINK_TOOL = { kind: "link", label: "链接", title: "为选中文字添加链接" } as const;
const QUOTE_TOOL = { kind: "line-prefix", label: "引用", title: "将选中行设为引用", prefix: "> ", placeholder: "引用内容" } as const;
const UNORDERED_LIST_TOOL = { kind: "line-prefix", label: "无序列表", title: "将选中行设为无序列表", prefix: "- ", placeholder: "列表项" } as const;
const ORDERED_LIST_TOOL = { kind: "line-prefix", label: "有序列表", title: "将选中行设为有序列表", prefix: "1. ", placeholder: "列表项" } as const;
const CODE_TOOL = { kind: "wrap", label: "代码", title: "将选中文字设为代码块", before: "```\n", after: "\n```", placeholder: "const value = true" } as const;
const IMAGE_TOOL = { kind: "image", label: "图片", title: "插入图片（输入网址或上传）" } as const;
const GALLERY_TOOL = { kind: "gallery", label: "图片合集", title: "插入多张图片合集" } as const;
const MUSIC_TOOL = { kind: "music", label: "音乐", title: "插入音乐播放器（网易云/QQ 等）" } as const;
const VIDEO_TOOL = { kind: "video", label: "视频", title: "插入 Bilibili 或 YouTube 视频" } as const;
const DIVIDER_TOOL = { kind: "raw", label: "分隔线", title: "插入分隔线", text: "\n---\n" } as const;

/** 关于页可安全渲染的文章编辑器工具；文章引用必须绑定文章专属快照，故不在此列表中。 */
export const STANDARD_MARKDOWN_TOOLS = [
  H2_TOOL, BOLD_TOOL, ITALIC_TOOL, LINK_TOOL, QUOTE_TOOL, UNORDERED_LIST_TOOL, ORDERED_LIST_TOOL, CODE_TOOL, IMAGE_TOOL, MUSIC_TOOL, VIDEO_TOOL, DIVIDER_TOOL,
] as const satisfies readonly MarkdownTool[];

/** 文章正文额外支持带快照的 Article Reference。 */
export const ARTICLE_MARKDOWN_TOOLS = [
  H2_TOOL, BOLD_TOOL, ITALIC_TOOL, LINK_TOOL,
  { kind: "reference", label: "文章引用", title: "读取公众号或网页文章并插入引用卡片" },
  QUOTE_TOOL, UNORDERED_LIST_TOOL, ORDERED_LIST_TOOL, CODE_TOOL, IMAGE_TOOL, GALLERY_TOOL, MUSIC_TOOL, VIDEO_TOOL, DIVIDER_TOOL,
] as const satisfies readonly MarkdownTool[];

export function MarkdownToolbar({ tools, onBeforeTool, onTool }: {
  tools: readonly MarkdownTool[];
  onBeforeTool: () => void;
  onTool: (tool: MarkdownTool) => void;
}) {
  return (
    <div className="mb-2 flex flex-wrap gap-1.5 rounded-lg border border-neutral-200 bg-neutral-50 p-2 lg:sticky lg:top-20 lg:z-10" aria-label="Markdown 工具栏">
      {tools.map((tool) => (
        <button
          key={tool.label}
          type="button"
          title={tool.title}
          onPointerDown={(event) => {
            event.preventDefault();
            onBeforeTool();
          }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onTool(tool)}
          className="rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs text-neutral-700 transition-colors hover:border-accent hover:text-accent active:bg-accent/10"
        >
          {tool.label}
        </button>
      ))}
    </div>
  );
}
