"use client";

import { useCallback, useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent, type UIEvent } from "react";

/** Scroll once per requested turn, never on card expansion, approvals or loading ticks. */
export function useNemesisChatScroll(open: boolean, latestEntryId: string | undefined, running: boolean) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef<HTMLDivElement>(null);
  const latestResponseRef = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<"loading" | "response" | null>(null);
  const followTurn = useRef(true);
  const savedTop = useRef(0);

  const alignRequestedTurn = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || !pendingScroll.current) return;
    const target = pendingScroll.current === "loading" ? loadingRef.current : latestResponseRef.current;
    if (!target) return;
    const padding = parseFloat(getComputedStyle(viewport).paddingTop) || 0;
    // Move only this scroll container, not the document or the surrounding drawer.
    viewport.scrollTop += target.getBoundingClientRect().top - viewport.getBoundingClientRect().top - padding;
    savedTop.current = viewport.scrollTop;
    pendingScroll.current = null;
  }, []);

  // A callback ref also handles modal/portal mounts that happen after the drawer opens.
  // Reserve a viewport-sized latest reply so even short results can start at the top.
  // CSS variables avoid React state updates or following changes inside report cards.
  const scrollRef = useCallback((viewport: HTMLDivElement | null) => {
    viewportRef.current = viewport;
    if (!viewport) return;
    const measure = () => viewport.style.setProperty("--nemesis-chat-viewport", `${viewport.clientHeight}px`);
    measure();
    viewport.scrollTop = savedTop.current;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    // Child response refs are normally attached already; the layout effect below
    // covers the same commit if they are attached after this callback.
    alignRequestedTurn();
    return () => {
      savedTop.current = viewport.scrollTop;
      observer.disconnect();
      viewportRef.current = null;
    };
  }, [alignRequestedTurn]);

  useLayoutEffect(() => {
    if (open) alignRequestedTurn();
  }, [open, latestEntryId, running, alignRequestedTurn]);

  function beginTurn() {
    followTurn.current = true;
    pendingScroll.current = "loading";
  }
  function showResponse() {
    if (followTurn.current) pendingScroll.current = "response";
  }
  function stopFollowing() {
    // If an admin scrolls back while a request runs, don't pull them away on completion.
    followTurn.current = false;
    pendingScroll.current = null;
  }
  function onScroll(event: UIEvent<HTMLDivElement>) {
    savedTop.current = event.currentTarget.scrollTop;
  }
  function onPointerDownCapture(event: PointerEvent<HTMLDivElement>) {
    const viewport = event.currentTarget;
    const left = viewport.getBoundingClientRect().left + viewport.clientLeft;
    if (event.clientX < left || event.clientX >= left + viewport.clientWidth) stopFollowing();
  }
  function onKeyDownCapture(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable=true]")) return;
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) stopFollowing();
  }

  return {
    scrollRef, loadingRef, latestResponseRef, beginTurn, showResponse,
    interactionProps: { onScroll, onWheelCapture: stopFollowing, onTouchMoveCapture: stopFollowing, onPointerDownCapture, onKeyDownCapture },
  };
}
