import type { DocumentFormatDescriptor } from "@lumen/api-contract";

import type { FormatRenderer } from "./renderer-contract";

export class RendererRegistry {
  private readonly renderersByFormatId = new Map<string, FormatRenderer>();

  constructor(renderers: readonly FormatRenderer[]) {
    for (const renderer of renderers) {
      if (this.renderersByFormatId.has(renderer.formatId)) {
        throw new Error(`Format Renderer 重复注册：${renderer.formatId}`);
      }
      this.renderersByFormatId.set(renderer.formatId, renderer);
    }
  }

  resolve(descriptor: DocumentFormatDescriptor): FormatRenderer | null {
    const renderer = this.renderersByFormatId.get(descriptor.formatId);
    return renderer?.supports(descriptor) ? renderer : null;
  }
}
