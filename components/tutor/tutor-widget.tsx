"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { MessagesSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { TutorPanel } from "@/components/tutor/tutor-panel";
import { useTutorWidget } from "@/components/tutor/tutor-widget-provider";

/**
 * The floating launcher and its popup (SPEC §18). One Radix Dialog root:
 * non-modal with an anchored panel on desktop, a modal full-screen sheet on
 * phones. The provider decides visibility and open state; this file only
 * decides how it looks.
 */
export function TutorWidget() {
  const w = useTutorWidget();
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  if (!w.visible) return null;

  return (
    <DialogPrimitive.Root
      open={w.open}
      onOpenChange={w.setOpen}
      modal={!w.isDesktop}
    >
      <Launcher />
      {w.isDesktop ? (
        <DesktopPanel composerRef={composerRef} transcriptRef={transcriptRef} />
      ) : (
        <MobilePanel composerRef={composerRef} transcriptRef={transcriptRef} />
      )}
    </DialogPrimitive.Root>
  );
}

function Launcher() {
  const { open, unread, hostKind } = useTutorWidget();
  return (
    <DialogPrimitive.Trigger asChild>
      <Button
        size="icon-lg"
        data-host={hostKind ?? undefined}
        aria-label={open ? "Close AI tutor" : "AI tutor"}
        className={cn(
          "fixed right-5 z-40 size-14 shadow-lg",
          // Safe-area padded so the home indicator never covers it.
          "bottom-[calc(--spacing(5)+env(safe-area-inset-bottom))]",
          // Above the tutor-mode runner's sticky footer on phones; that bar
          // is sm:hidden, so the offset drops away with it.
          "max-sm:data-[host=runner]:bottom-[calc(4.5rem+env(safe-area-inset-bottom))]"
        )}
      >
        {open ? (
          <X className="size-6" aria-hidden="true" />
        ) : (
          <MessagesSquare className="size-6" aria-hidden="true" />
        )}
        {unread && !open && (
          <>
            {/* Gold IS the accent on crimson (globals.css) — not `sun`,
                which means caution. */}
            <span
              className="absolute top-1 right-1 size-3 rounded-full bg-gold ring-2 ring-background"
              aria-hidden="true"
            />
            <span className="sr-only">New answer</span>
          </>
        )}
      </Button>
    </DialogPrimitive.Trigger>
  );
}

type PanelRefs = {
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  transcriptRef: React.RefObject<HTMLDivElement | null>;
};

function DesktopPanel({ composerRef, transcriptRef }: PanelRefs) {
  const { openedByUser } = useTutorWidget();
  const contentRef = useRef<HTMLDivElement | null>(null);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Content
        ref={contentRef}
        aria-describedby={undefined}
        className={cn(
          "fixed right-5 z-40 flex w-[26rem] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden",
          "h-[min(40rem,85dvh)] rounded-2xl border border-border bg-background shadow-xl outline-none",
          // Stacked above the launcher (3.5rem) with a gap.
          "bottom-[calc(--spacing(5)+4.5rem+env(safe-area-inset-bottom))]",
          "duration-200 data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-4 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none"
        )}
        // Non-modal by design: the panel sits beside the page the student is
        // reading, so clicking that page must not dismiss it.
        onInteractOutside={(e) => e.preventDefault()}
        // Radix would focus the first tabbable (a header button); the
        // composer is what a student who opened a chat wants. A panel
        // restored from the saved flag on page load leaves focus alone.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          if (openedByUser) composerRef.current?.focus();
        }}
        // Esc is document-wide in a non-modal layer. Only honour it when the
        // student is IN the panel, so it never steals Esc from the page.
        onEscapeKeyDown={(e) => {
          if (!contentRef.current?.contains(document.activeElement)) {
            e.preventDefault();
          }
        }}
      >
        <TutorPanel composerRef={composerRef} transcriptRef={transcriptRef} />
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function MobilePanel({ composerRef, transcriptRef }: PanelRefs) {
  const height = useVisualViewportHeight();
  return (
    <SheetContent
      side="bottom"
      showCloseButton={false}
      aria-describedby={undefined}
      // The bottom sheet is h-auto by default; this one fills the screen.
      // Height follows the visual viewport (see the hook) so the composer
      // stays above the iOS keyboard, which does not shrink 100dvh.
      className="inset-0 h-dvh gap-0 rounded-none border-0 p-0"
      style={height ? { height } : undefined}
      // Not the composer: raising the keyboard on open would cover the
      // transcript, and programmatic focus outside a tap is unreliable on
      // iOS anyway. The transcript is focusable for exactly this.
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        transcriptRef.current?.focus({ preventScroll: true });
      }}
    >
      <TutorPanel composerRef={composerRef} transcriptRef={transcriptRef} />
    </SheetContent>
  );
}

/** The visual viewport's height, or null where unsupported / unchanged. */
function useVisualViewportHeight(): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      // Only override the CSS height once the keyboard (or browser chrome)
      // actually shrinks the viewport; otherwise h-dvh is right.
      setHeight(vv.height < window.innerHeight - 1 ? vv.height : null);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return height;
}
