import { SiteLayoutInner } from "@/components/site/SiteLayoutInner";
import { SiteSidebarData } from "@/components/site/SiteSidebarData";
import { getCachedCategories, getCachedPublishedTags, getCachedSiteSettings } from "@/lib/server-data";
import { renderMarkdown } from "@/lib/markdown";
import { DEFAULT_CLASSIC_SIDEBAR_INTRO } from "@/lib/theme";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  const siteSettings = getCachedSiteSettings();
  const categories = getCachedCategories();
  const tags = getCachedPublishedTags(12);
  const classicSidebarIntro = Object.hasOwn(siteSettings, "classic_sidebar_intro")
    ? siteSettings.classic_sidebar_intro.trim()
    : DEFAULT_CLASSIC_SIDEBAR_INTRO;
  const classicSidebarIntroHtml = classicSidebarIntro ? renderMarkdown(classicSidebarIntro) : "";
  return <SiteLayoutInner siteSettings={siteSettings} categories={categories} tags={tags} classicSidebarIntroHtml={classicSidebarIntroHtml} sidebarData={<SiteSidebarData siteSettings={siteSettings} />}>{children}</SiteLayoutInner>;
}
