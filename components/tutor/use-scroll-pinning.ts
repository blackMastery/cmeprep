"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/** How close to the bottom still counts as "following along", in px. Below
 * this the student has scrolled up to reread and must not be yanked back. */
const PINNED_SLACK_PX = 120;

/** Layout effect on the client, plain effect during SSR.
 *
 * The scroll correction below MUST land before the browser paints, and calling
 * useLayoutEffect while rendering on the server logs a warning. Client
 * Components are server-rendered for the initial HTML, so the swap is real. */
const useBeforePaint =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Keep the bottom of a growing transcript in view — but only while the
 * student is already there.
 *
 * `container` null means the document scrolls (the /tutor page); a ref means
 * the element does (the widget panel). Streaming appends on every token, and
 * scrolling unconditionally makes it impossible to scroll up and reread while
 * the rest of the answer arrives.
 */
export function useScrollPinning(
  container: RefObject<HTMLElement | null> | null,
  deps: readonly unknown[]
) {
  /** Whether the student is following the bottom of the transcript. */
  const pinnedRef = useRef(true);

  useEffect(() => {
    const el = container?.current ?? null;
    const target: HTMLElement | Window = el ?? window;
    const onScroll = () => {
      const slack = el
        ? el.scrollHeight - el.scrollTop - el.clientHeight
        : document.documentElement.scrollHeight -
          window.scrollY -
          window.innerHeight;
      pinnedRef.current = slack < PINNED_SLACK_PX;
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
  }, [container]);

  useBeforePaint(() => {
    if (!pinnedRef.current) return;
    const el = container?.current ?? null;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
      return;
    }
    // BEFORE paint, and to an absolute position rather than via scrollIntoView.
    // On the page the composer is `sticky bottom-0`, so every token that grows
    // the transcript pushes its resting position down; correcting the scroll
    // in a passive effect let the browser paint one frame with the composer
    // displaced and the next with it back — a ~30px bounce on every token
    // (measured: its viewport top oscillating 769 <-> 802). Running before
    // paint means the growth and the correction land in the same frame.
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "instant",
    });
  }, deps);
}
