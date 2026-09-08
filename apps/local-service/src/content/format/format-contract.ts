import type {
  DocumentCapabilities,
  DocumentFormatDescriptor,
  OutlineEntry,
  SemanticBlock,
} from "@lumen/api-contract";

export interface DocumentSourceProbe {
  originalFilename: string;
  mediaType: string | null;
}

export interface DocumentSource {
  probe: DocumentSourceProbe;
  content: Uint8Array;
}

export interface DocumentInspection {
  suggestedTitle: string | null;
  capabilities: DocumentCapabilities;
  warnings: string[];
}

export interface SourceMappingArtifact {
  mappingId: string;
  blockId: string;
  mappingKind: string;
  semanticStartOffset: number;
  semanticEndOffset: number;
  sourceStartOffset: number;
  sourceEndOffset: number;
}

export interface ExtractedResourceArtifact {
  mediaType: string;
  role: "embedded_resource";
  content: Uint8Array;
}

export interface ImportArtifact {
  descriptor: DocumentFormatDescriptor;
  capabilities: DocumentCapabilities;
  renderHtml: string;
  blocks: SemanticBlock[];
  outline: OutlineEntry[];
  sourceMappings: SourceMappingArtifact[];
  resources: ExtractedResourceArtifact[];
}

export interface DocumentAdapter {
  readonly descriptor: DocumentFormatDescriptor;
  readonly sourceFileExtension: string;
  readonly sourceMediaType: string;
  detect(probe: DocumentSourceProbe): boolean;
  inspect(source: DocumentSource): Promise<DocumentInspection>;
  import(source: DocumentSource, revisionId: string): Promise<ImportArtifact>;
  extractResources(source: DocumentSource): Promise<ExtractedResourceArtifact[]>;
  validateArtifact(artifact: ImportArtifact): void;
}

export interface FormatAdapterRegistryPort {
  resolve(probe: DocumentSourceProbe): DocumentAdapter | null;
  get(formatId: string): DocumentAdapter | null;
}

export class DocumentSourceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DocumentSourceError";
  }
}
