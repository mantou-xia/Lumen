import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DocumentFormatDescriptor } from "@lumen/api-contract";

import type { UiPreferences } from "../app/preferences";
import { Button } from "../app/ui";
import type { RendererEvent, RendererHandle } from "./renderer-contract";
import { RendererRegistry } from "./renderer-registry";

interface FormatRendererHostProps {
  registry: RendererRegistry;
  descriptor: DocumentFormatDescriptor;
  revisionId: string;
  renderProjection: string;
  preferences: UiPreferences;
  onEvent(event: RendererEvent): void;
  onMissingImage(resourceId: string): void;
  onReady(handle: RendererHandle | null): void;
}

export function FormatRendererHost({
  registry,
  descriptor,
  revisionId,
  renderProjection,
  preferences,
  onEvent,
  onMissingImage,
  onReady,
}: FormatRendererHostProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<RendererHandle | null>(null);
  const eventHandlerRef = useRef(onEvent);
  const preferencesRef = useRef(preferences);
  const missingImageHandlerRef = useRef(onMissingImage);
  const [missingImages, setMissingImages] = useState<Array<{ element: HTMLElement; resourceId: string }>>([]);
  eventHandlerRef.current = onEvent;
  preferencesRef.current = preferences;
  missingImageHandlerRef.current = onMissingImage;

  useEffect(() => {
    const container = containerRef.current;
    const renderer = registry.resolve(descriptor);
    if (container === null) return;
    if (renderer === null) {
      eventHandlerRef.current({
        type: "renderFailed",
        message: `没有兼容 ${descriptor.formatId} 的文档 Renderer`,
      });
      return;
    }

    try {
      const handle = renderer.mount({
        container,
        descriptor,
        revisionId,
        renderProjection,
        preferences: preferencesRef.current,
        publish: (event) => eventHandlerRef.current(event),
      });
      handle.updatePreferences(preferencesRef.current);
      handleRef.current = handle;
      const placeholders = Array.from(
        container.querySelectorAll<HTMLElement>("[data-missing-image-id]"),
      ).flatMap((element) => {
        const resourceId = element.dataset.missingImageId;
        if (resourceId === undefined) return [];
        element.replaceChildren();
        return [{ element, resourceId }];
      });
      setMissingImages(placeholders);
      onReady(handle);
    } catch (error) {
      eventHandlerRef.current({
        type: "renderFailed",
        message: error instanceof Error ? error.message : "文档 Renderer 初始化失败",
      });
    }

    return () => {
      handleRef.current?.dispose();
      handleRef.current = null;
      setMissingImages([]);
      onReady(null);
    };
  }, [descriptor, onReady, registry, renderProjection, revisionId]);

  useEffect(() => {
    handleRef.current?.updatePreferences(preferences);
  }, [preferences]);

  return (
    <>
      <div className="format-renderer-host" ref={containerRef} />
      {missingImages.map(({ element, resourceId }) => createPortal(
        <Button
          className="reader-missing-image-action"
          type="button"
          variant="secondary"
          onClick={() => missingImageHandlerRef.current(resourceId)}
        >
          图片已被删除或移动
        </Button>,
        element,
        resourceId,
      ))}
    </>
  );
}
