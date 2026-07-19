import Image from "next/image";

/**
 * Question figure. Dimensions aren't stored, so this uses `fill` inside a
 * bounded box with object-contain — a tall chest film then can't blow out the
 * layout, and the aspect ratio is preserved either way.
 */
export function QuestionImage({
  src,
  alt = "",
  maxHeight = 380,
}: {
  src: string;
  alt?: string;
  maxHeight?: number;
}) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-xl border border-border bg-muted"
      style={{ height: maxHeight }}
    >
      <Image
        src={src}
        alt={alt}
        fill
        sizes="(max-width: 768px) 100vw, 640px"
        className="object-contain"
      />
    </div>
  );
}
