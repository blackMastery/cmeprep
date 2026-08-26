"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { tutorLauncherVisible, TUTOR_WIDGET_OPEN_KEY } from "@/lib/tutor-core";
import {
  useConversationStore,
  type ConversationActions,
  type ConversationState,
} from "@/components/tutor/use-tutor-conversation";

/** Tailwind's `md` — the panel is anchored from here up, a sheet below. */
const DESKTOP_QUERY = "(min-width: 768px)";

function subscribeDesktop(onChange: () => void) {
  const mq = window.matchMedia(DESKTOP_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const readDesktop = () => window.matchMedia(DESKTOP_QUERY).matches;
/** Server snapshot. Either answer is safe — the panel renders closed on the
 * server regardless — and desktop avoids a modal sheet mounting for a frame. */
const readDesktopOnServer = () => true;

// Storage can throw (private mode, blocked site data); a widget must never
// take the page down over a remembered preference.
function readStoredOpen(): boolean {
  try {
    return window.localStorage.getItem(TUTOR_WIDGET_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}
function writeStoredOpen(open: boolean) {
  try {
    if (open) window.localStorage.setItem(TUTOR_WIDGET_OPEN_KEY, "1");
    else window.localStorage.removeItem(TUTOR_WIDGET_OPEN_KEY);
  } catch {
    // ignore
  }
}

/**
 * "Is the panel open" as an external store rather than useState.
 *
 * The first client value comes from localStorage, which the server cannot
 * read. useSyncExternalStore renders the server snapshot (closed) during
 * hydration and then the client one, which is the sanctioned way to differ
 * from the server — a useState initialiser would mismatch, and an effect
 * that sets state after mount is the cascading render the lint rule forbids.
 * Module-level on purpose: one widget per document.
 */
type OpenSnapshot = {
  open: boolean;
  /** The current open was a click on the launcher, not the restored flag.
   * Only a deliberate open should move focus into the composer — a restored
   * panel stealing focus on every page load would take Space and the arrow
   * keys away from scrolling. */
  byUser: boolean;
};
const OPEN_ON_SERVER: OpenSnapshot = { open: false, byUser: false };
const openStore = {
  // A stable object per state, as useSyncExternalStore requires.
  value: null as OpenSnapshot | null,
  listeners: new Set<() => void>(),
};
function readOpen(): OpenSnapshot {
  if (openStore.value === null) {
    // Restored on desktop only: a full-screen sheet on load would hide the
    // page the student came for.
    openStore.value = { open: readDesktop() && readStoredOpen(), byUser: false };
  }
  return openStore.value;
}
const readOpenOnServer = () => OPEN_ON_SERVER;
function subscribeOpen(onChange: () => void) {
  openStore.listeners.add(onChange);
  return () => {
    openStore.listeners.delete(onChange);
  };
}
function writeOpen(next: OpenSnapshot, persist: boolean) {
  openStore.value = next;
  if (persist) writeStoredOpen(next.open);
  for (const l of openStore.listeners) l();
}

/** A screen that has opted the launcher back in on a route that hides it by
 * default. Only the tutor-mode runner does today. */
export type TutorHost = { kind: "runner" };

type Controls = {
  available: boolean;
  /** The launcher renders. False also hides the panel. */
  visible: boolean;
  open: boolean;
  isDesktop: boolean;
  unread: boolean;
  hostKind: TutorHost["kind"] | null;
  /** The current open was a click on the launcher, not a restored flag. */
  openedByUser: boolean;
  setOpen: (open: boolean) => void;
  registerHost: (id: string, host: TutorHost) => void;
  unregisterHost: (id: string) => void;
} & ConversationActions;

/**
 * Two contexts on purpose (SPEC §18): controls change rarely and are what a
 * test runner or an "ask about this" button needs; the conversation changes
 * on every streamed token and is read only by the two shells. One context
 * would rerender the whole runner tree per token.
 */
const ControlsContext = createContext<Controls | null>(null);
const ConversationContext = createContext<ConversationState | null>(null);

export function TutorWidgetProvider({
  available,
  children,
}: {
  /** TUTOR_API_URL is set — decided by the server layout, no fetch. */
  available: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const isDesktop = useSyncExternalStore(
    subscribeDesktop,
    readDesktop,
    readDesktopOnServer
  );
  const { open, byUser: openedByUser } = useSyncExternalStore(
    subscribeOpen,
    readOpen,
    readOpenOnServer
  );
  const [unread, setUnread] = useState(false);
  const [hosts, setHosts] = useState<Map<string, TutorHost>>(() => new Map());

  const hostKind = hosts.values().next().value?.kind ?? null;
  const visible = tutorLauncherVisible({
    available,
    pathname,
    hostRegistered: hosts.size > 0,
  });
  // Derived, never persisted: leaving /tutor must find the panel as it was.
  const effectiveOpen = open && visible;
  // "Unread" means an answer landed where the student could not see it: the
  // panel closed, or a route that hides it. The full page counts as seeing
  // it — an answer read on /tutor must not light the dot on the way out.
  const onScreen = effectiveOpen || pathname === "/tutor";
  const onScreenRef = useRef(onScreen);
  useEffect(() => {
    onScreenRef.current = onScreen;
  }, [onScreen]);

  const [conversation, storeActions] = useConversationStore({
    onSettled: useCallback(() => {
      if (!onScreenRef.current) setUnread(true);
    }, []),
  });
  // Arriving on the full page is also "I've seen it".
  const seed = useCallback(
    (state: Parameters<ConversationActions["seed"]>[0]) => {
      storeActions.seed(state);
      setUnread(false);
    },
    [storeActions]
  );
  const actions = useMemo<ConversationActions>(
    () => ({ ...storeActions, seed }),
    [storeActions, seed]
  );


  const setOpen = useCallback((next: boolean) => {
    // Persisted on desktop only (see readOpen). Opening is also "I've seen
    // it": the dot only ever means an answer landed while this was closed.
    writeOpen({ open: next, byUser: next }, readDesktop());
    if (next) setUnread(false);
  }, []);

  // Opening lazily loads; the store decides whether it is fresh enough to
  // skip the fetch.
  const { loadState } = actions;
  useEffect(() => {
    if (effectiveOpen) void loadState();
  }, [effectiveOpen, loadState]);

  // Crossing the breakpoint while open closes the panel rather than flipping
  // `modal` under an open Radix dialog. Not persisted: the desktop flag
  // should still reopen it when the window grows back.
  const wasDesktop = useRef(isDesktop);
  useEffect(() => {
    if (wasDesktop.current === isDesktop) return;
    wasDesktop.current = isDesktop;
    writeOpen({ open: false, byUser: false }, false);
  }, [isDesktop]);

  // A dead session must not reopen a dead panel after the login round trip.
  useEffect(() => {
    if (conversation.signedOut) writeStoredOpen(false);
  }, [conversation.signedOut]);

  const registerHost = useCallback((id: string, host: TutorHost) => {
    setHosts((prev) => {
      const next = new Map(prev);
      next.set(id, host);
      return next;
    });
  }, []);
  const unregisterHost = useCallback((id: string) => {
    setHosts((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const controls = useMemo<Controls>(
    () => ({
      available,
      visible,
      open: effectiveOpen,
      isDesktop,
      unread,
      hostKind,
      openedByUser,
      setOpen,
      registerHost,
      unregisterHost,
      ...actions,
    }),
    [
      available,
      visible,
      effectiveOpen,
      isDesktop,
      unread,
      hostKind,
      openedByUser,
      setOpen,
      registerHost,
      unregisterHost,
      actions,
    ]
  );

  return (
    <ControlsContext.Provider value={controls}>
      <ConversationContext.Provider value={conversation}>
        {children}
      </ConversationContext.Provider>
    </ControlsContext.Provider>
  );
}

/** Open/close, the launcher's state, and the conversation ACTIONS. */
export function useTutorWidget(): Controls {
  const ctx = useContext(ControlsContext);
  if (!ctx) throw new Error("useTutorWidget needs TutorWidgetProvider");
  return ctx;
}

/** The live transcript. Rerenders per token — shells only. */
export function useTutorConversation(): ConversationState {
  const ctx = useContext(ConversationContext);
  if (!ctx) throw new Error("useTutorConversation needs TutorWidgetProvider");
  return ctx;
}

/**
 * Opt the launcher back in on a route that hides it by default. Registered on
 * mount and released on unmount, keyed by a stable id so Strict Mode's
 * mount → cleanup → mount is idempotent. A no-op outside the provider, so the
 * runner can be rendered in isolation.
 */
export function useTutorWidgetHost(kind: TutorHost["kind"] = "runner") {
  const ctx = useContext(ControlsContext);
  const id = useId();
  const register = ctx?.registerHost;
  const unregister = ctx?.unregisterHost;
  useEffect(() => {
    if (!register || !unregister) return;
    register(id, { kind });
    return () => unregister(id);
  }, [register, unregister, id, kind]);
}
