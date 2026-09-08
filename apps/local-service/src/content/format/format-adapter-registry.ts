import type {
  DocumentAdapter,
  DocumentSourceProbe,
  FormatAdapterRegistryPort,
} from "./format-contract.js";

export class FormatAdapterRegistry implements FormatAdapterRegistryPort {
  private readonly adaptersByFormatId = new Map<string, DocumentAdapter>();

  constructor(adapters: readonly DocumentAdapter[]) {
    for (const adapter of adapters) {
      const formatId = adapter.descriptor.formatId;
      if (this.adaptersByFormatId.has(formatId)) {
        throw new Error(`Format Adapter 重复注册：${formatId}`);
      }
      this.adaptersByFormatId.set(formatId, adapter);
    }
  }

  resolve(probe: DocumentSourceProbe): DocumentAdapter | null {
    return [...this.adaptersByFormatId.values()].find((adapter) => adapter.detect(probe)) ?? null;
  }

  get(formatId: string): DocumentAdapter | null {
    return this.adaptersByFormatId.get(formatId) ?? null;
  }
}
