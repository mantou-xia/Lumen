import { useCallback, useEffect, useRef, useState } from "react";

export type ReaderOverlay = "outline" | "translation" | "recall" | "workspace";

export function useOverlayManager() {
  const [activeOverlay, setActiveOverlay] = useState<ReaderOverlay | null>(null);
  const overlayRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const closeOverlay = useCallback((overlay?: ReaderOverlay) => {
    setActiveOverlay((current) => {
      if (overlay !== undefined && current !== overlay) return current;
      requestAnimationFrame(() => returnFocusRef.current?.focus({ preventScroll: true }));
      return null;
    });
  }, []);

  const openOverlay = useCallback((overlay: ReaderOverlay) => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setActiveOverlay(overlay);
  }, []);

  const toggleOverlay = useCallback((overlay: ReaderOverlay) => {
    if (activeOverlay === overlay) closeOverlay(overlay);
    else openOverlay(overlay);
  }, [activeOverlay, closeOverlay, openOverlay]);

  useEffect(() => {
    if (activeOverlay === null) return;
    const focusTimer = requestAnimationFrame(() => overlayRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeOverlay();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [activeOverlay, closeOverlay]);

  const handleRootPointerDown = useCallback((target: EventTarget | null) => {
    if (activeOverlay === null || !(target instanceof Node)) return;
    if (target instanceof Element && target.closest("[data-reader-overlay-trigger]")) return;
    if (!overlayRef.current?.contains(target)) closeOverlay();
  }, [activeOverlay, closeOverlay]);

  return {
    activeOverlay,
    closeOverlay,
    handleRootPointerDown,
    openOverlay,
    overlayRef,
    toggleOverlay,
  };
}
