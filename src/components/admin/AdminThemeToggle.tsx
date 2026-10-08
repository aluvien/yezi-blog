"use client";

import { useEffect } from "react";
import { MoonStar, Sun } from "lucide-react";

export function AdminThemeToggle() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applySystemTheme = () => {
      if (!document.cookie.includes("theme_mode=")) {
        document.documentElement.dataset.theme = media.matches ? "dark" : "light";
      }
    };
    media.addEventListener("change", applySystemTheme);
    return () => media.removeEventListener("change", applySystemTheme);
  }, []);

  function toggleTheme() {
    const root = document.documentElement;
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    document.cookie = `theme_mode=${next}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <button
      type="button"
      className="admin-theme-toggle"
      aria-label="切换后台明暗主题"
      title="切换后台明暗主题"
      onClick={toggleTheme}
    >
      <MoonStar className="admin-theme-icon admin-theme-icon--moon" strokeWidth={1.6} aria-hidden="true" />
      <Sun className="admin-theme-icon admin-theme-icon--sun" strokeWidth={1.6} aria-hidden="true" />
    </button>
  );
}
