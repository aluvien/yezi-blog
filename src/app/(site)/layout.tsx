import { SiteLayoutInner } from "@/components/site/SiteLayoutInner";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <SiteLayoutInner>{children}</SiteLayoutInner>;
}
