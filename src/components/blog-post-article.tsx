import { PageArticle } from "@/components/page-article";
import type { BlogPost } from "@/lib/types";

export function BlogPostArticle({ post }: { post: BlogPost }) {
  return <PageArticle page={post} breadcrumbItems={[{ label: "Home", href: "/" }, { label: "Blog", href: "/blog" }, { label: post.title }]} />;
}
