import { cache } from "react";
import {
  getPostBySlug,
  getSiteSettings,
  listCategories,
  listMoments,
  listPosts,
  listPublishedTags,
  listWorks,
} from "@/lib/db";

/** Request-local memoization for identical server-component reads. */
export const getCachedSiteSettings = cache(() => getSiteSettings());
export const getCachedCategories = cache(() => listCategories());
export const getCachedPublishedTags = cache((limit: number) => listPublishedTags(limit));
export const getCachedPublishedPosts = cache(() => listPosts());
export const getCachedMoments = cache(() => listMoments());
export const getCachedWorks = cache(() => listWorks());
export const getCachedPostBySlug = cache((slug: string) => getPostBySlug(slug));
