import { SiteLayoutInner } from "@/components/site/SiteLayoutInner";
import { SiteSidebarData } from "@/components/site/SiteSidebarData";
import { getSiteSettings, listCategories, listPublishedTags } from "@/lib/db";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  const siteSettings = getSiteSettings();
  const categories = listCategories();
  const tags = listPublishedTags(12);
  return <SiteLayoutInner siteSettings={siteSettings} categories={categories} tags={tags} sidebarData={<SiteSidebarData siteSettings={siteSettings} />}>{children}</SiteLayoutInner>;
}
