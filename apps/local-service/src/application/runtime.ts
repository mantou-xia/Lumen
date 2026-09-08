import type { Operation, OperationEvent, OperationEventQuery } from "@lumen/api-contract";

import { ApplicationError } from "./errors.js";
import type { ControlledTaskRuntimePort, RuntimeRepositoryPort } from "./ports.js";

const terminalStatuses = new Set(["completed", "failed", "cancelled", "interrupted"]);

export class RuntimeApplication {
  constructor(private readonly operations: Pick<
    RuntimeRepositoryPort,
    "getOperation" | "listOperationEvents"
  >, private readonly execution: Pick<ControlledTaskRuntimePort, "cancel">) {}

  getOperation(operationId: string): Operation {
    const operation = this.operations.getOperation(operationId);
    if (operation === null) {
      throw new ApplicationError({
        code: "OPERATION_NOT_FOUND",
        message: "未找到指定 Operation",
        statusCode: 404,
      });
    }
    return operation;
  }

  listEvents(operationId: string, query: OperationEventQuery): OperationEvent[] {
    this.getOperation(operationId);
    return this.operations.listOperationEvents(operationId, query.after, query.limit);
  }

  cancel(operationId: string): Operation {
    const operation = this.getOperation(operationId);
    if (!terminalStatuses.has(operation.status)) this.execution.cancel(operationId);
    return operation;
  }
}
