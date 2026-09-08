import type {
  Annotation,
  AnnotationRangeQuery,
  CreateAnnotationRequest,
} from "@lumen/api-contract";

import { ApplicationError } from "./errors.js";
import type { AnnotationApplicationDependencies } from "./ports.js";

export class AnnotationApplication {
  constructor(private readonly dependencies: AnnotationApplicationDependencies) {}

  create(documentId: string, input: CreateAnnotationRequest): Annotation {
    const selectionId = this.dependencies.ids.generate();
    const { selection } = this.dependencies.selection.normalize(documentId, input, selectionId);
    if (!this.dependencies.repository.sourceExists(documentId, input.revisionId, input.source)) {
      throw new ApplicationError({
        code: "ANNOTATION_SOURCE_INVALID",
        message: "标注引用的来源不存在或不属于当前文档版本",
        statusCode: 409,
      });
    }
    return this.dependencies.transaction.run(() => this.dependencies.repository.create({
      annotationId: this.dependencies.ids.generate(),
      selection,
      note: input.note,
      source: input.source,
      now: this.dependencies.clock.now(),
    }));
  }

  listRanges(documentId: string, input: AnnotationRangeQuery): Annotation[] {
    return this.dependencies.repository.listRanges(documentId, input);
  }

  get(annotationId: string): Annotation {
    const annotation = this.dependencies.repository.get(annotationId);
    if (annotation === null) throw annotationNotFound();
    return annotation;
  }

  update(annotationId: string, note: string): Annotation {
    const annotation = this.dependencies.transaction.run(() =>
      this.dependencies.repository.updateNote(annotationId, note, this.dependencies.clock.now()),
    );
    if (annotation === null) throw annotationNotFound();
    return annotation;
  }

  archive(annotationId: string): Annotation {
    const annotation = this.dependencies.transaction.run(() =>
      this.dependencies.repository.archive(annotationId, this.dependencies.clock.now()),
    );
    if (annotation === null) throw annotationNotFound();
    return annotation;
  }
}

function annotationNotFound(): ApplicationError {
  return new ApplicationError({
    code: "ANNOTATION_NOT_FOUND",
    message: "未找到指定标注",
    statusCode: 404,
  });
}
