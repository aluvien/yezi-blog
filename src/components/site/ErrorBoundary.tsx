"use client";

import { Component, type ReactNode } from "react";

/** 临时诊断用错误边界：捕获子树 client 端渲染错误并显示在页面上，便于无 console 时定位。 */
export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { error: Error | null }> {
  constructor(props: { children: ReactNode; label?: string }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: unknown) {
    console.error(`[ErrorBoundary${this.props.label ? ":" + this.props.label : ""}]`, error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 12, margin: 8, background: "#fff0f0", border: "1px solid #e0c0c0", color: "#900", borderRadius: 8, fontSize: 13 }}>
          ⚠️ 此区域加载失败{this.props.label ? `（${this.props.label}）` : ""}，请刷新页面重试。
        </div>
      );
    }
    return this.props.children;
  }
}
