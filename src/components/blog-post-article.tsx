import { PageArticle } from "@/components/page-article";
import type { BlogPost } from "@/lib/types";

export function BlogPostArticle({
  post,
  editHref,
  editLabel = "Edit post",
}: {
  post: BlogPost;
  editHref?: string;
  editLabel?: string;
}) {
  return (
    <PageArticle
      page={post}
      breadcrumbItems={[{ label: "Home", href: "/" }, { label: "Blog", href: "/blog" }, { label: post.title }]}
      editHref={editHref}
      editLabel={editLabel}
    />
  );
}
