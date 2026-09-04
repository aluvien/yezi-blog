"use client";

import { useEffect } from "react";

/** 为 Markdown 代码块提供轻量复制交互，不影响服务端生成的正文 HTML。 */
export function CodeCopyInitializer() {
  useEffect(() => {
    const onClick = async (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const expandButton = target.closest<HTMLButtonElement>("button[data-code-expand]");
      if (expandButton) {
        const block = expandButton.closest<HTMLElement>(".code-block[data-code-collapsible]");
        if (!block) return;
        const isCollapsed = block.dataset.collapsed !== "false";
        const nextCollapsed = !isCollapsed;
        block.dataset.collapsed = nextCollapsed ? "true" : "false";
        expandButton.setAttribute("aria-expanded", String(!nextCollapsed));
        const actionLabel = nextCollapsed ? "展开全部代码" : "收起代码";
        expandButton.setAttribute("aria-label", actionLabel);
        expandButton.title = actionLabel;
        const label = expandButton.querySelector<HTMLElement>(".code-expand-toggle__label");
        if (label) {
          label.textContent = nextCollapsed
            ? `展开全部代码${block.dataset.lines ? `（${block.dataset.lines} 行）` : ""}`
            : "收起代码";
        }
        return;
      }

      const button = target.closest<HTMLButtonElement>("button[data-code-copy]");
      if (!button) return;
      const code = button.closest(".code-block")?.querySelector("pre code");
      if (!code) return;
      const lines = Array.from(code.querySelectorAll<HTMLElement>(".line"));
      const text = (lines.length > 0 ? lines.map((line) => line.textContent ?? "").join("\n") : code.textContent ?? "").replace(/\n$/, "");
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      button.dataset.state = "copied";
      window.setTimeout(() => {
        if (button.isConnected) button.dataset.state = "idle";
      }, 1600);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return null;
}
