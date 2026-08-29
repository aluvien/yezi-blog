import PostPage, { generateMetadata } from "../../posts/[slug]/page";

export { generateMetadata };
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default PostPage;
