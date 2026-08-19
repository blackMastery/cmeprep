import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <Skeleton className="h-9 w-40" />
      <Skeleton className="mt-2 h-5 w-64" />
      <Skeleton className="mt-8 h-32 w-full rounded-2xl" />
      <Skeleton className="mt-6 h-14 w-full rounded-2xl" />
    </div>
  );
}
