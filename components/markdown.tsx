import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * The ONE markdown renderer for course content (lesson bodies, quiz prompts,
 * explanations, course descriptions) — learner pages and the admin preview
 * share it so authoring WYSIWYG-matches delivery.
 *
 * react-markdown never emits raw HTML from the source (no rehype-raw), which
 * IS the "sanitised, no raw HTML pass-through" rule from course-spec.md —
 * don't add rehype-raw here. Styling lives under .markdown-body in
 * globals.css because Preflight unstyles every element.
 */
export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={cn("markdown-body", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
