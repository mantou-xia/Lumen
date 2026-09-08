import { z } from "zod";

export const documentFormatIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/);

export const documentCapabilitiesSchema = z.object({
  selectableText: z.boolean(),
  stableSourceLocation: z.boolean(),
  nativeOutline: z.boolean(),
  pagination: z.boolean(),
  reflow: z.boolean(),
  originalLayout: z.boolean(),
  embeddedResources: z.boolean(),
  search: z.boolean(),
  annotations: z.boolean(),
});

export const documentFormatDescriptorSchema = z.object({
  formatId: documentFormatIdSchema,
  adapterVersion: z.string().min(1),
  semanticProjectionVersion: z.string().min(1),
  renderProjectionVersion: z.string().min(1),
  sourceMappingVersion: z.string().min(1),
  supportedCapabilities: documentCapabilitiesSchema,
});

export type DocumentFormatId = z.infer<typeof documentFormatIdSchema>;
export type DocumentCapabilities = z.infer<typeof documentCapabilitiesSchema>;
export type DocumentFormatDescriptor = z.infer<typeof documentFormatDescriptorSchema>;
