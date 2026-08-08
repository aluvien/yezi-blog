import { SiteLayoutInner } from "@/components/site/SiteLayoutInner";
import { SiteSidebarData } from "@/components/site/SiteSidebarData";
import { getCachedCategories, getCachedPublishedTags, getCachedSiteSettings } from "@/lib/server-data";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  const siteSettings = getCachedSiteSettings();
  const categories = getCachedCategories();
  const tags = getCachedPublishedTags(12);
  return <SiteLayoutInner siteSettings={siteSettings} categories={categories} tags={tags} sidebarData={<SiteSidebarData siteSettings={siteSettings} />}>{children}</SiteLayoutInner>;
}
