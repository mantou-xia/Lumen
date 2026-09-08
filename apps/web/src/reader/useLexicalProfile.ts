import { useCallback, useEffect, useRef, useState } from "react";
import type { LexicalProfileResponse } from "@lumen/api-contract";

import { getLexicalProfile, refreshLexicalProfile } from "../api/lexical";

export function useLexicalProfile(translationId: string | null) {
  const [response, setResponse] = useState<LexicalProfileResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback((refresh: boolean) => {
    if (translationId === null) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus("loading");
    setError(null);
    const request = refresh ? refreshLexicalProfile : getLexicalProfile;
    void request(translationId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setResponse(result);
          setStatus("idle");
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "无法读取词汇资料");
          setStatus("error");
        }
      });
  }, [translationId]);

  useEffect(() => {
    setResponse(null);
    setError(null);
    if (translationId === null) {
      setStatus("idle");
      return;
    }
    load(false);
    return () => controllerRef.current?.abort();
  }, [load, translationId]);

  return {
    error,
    refresh: () => load(true),
    response,
    status,
  };
}
