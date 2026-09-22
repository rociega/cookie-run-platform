import type { SourceControlValidation } from "@workspace/api-client-react";

export type SourceValidationState =
  | "not_connected"
  | "loading"
  | "connected"
  | "permission_required"
  | "expired"
  | "error";

export function getSourceValidationState(input: {
  repositoryUrl: string;
  isPending: boolean;
  validation?: SourceControlValidation | null;
  failed?: boolean;
}): SourceValidationState {
  if (!input.repositoryUrl.trim()) return "not_connected";
  if (input.isPending) return "loading";
  if (input.failed || !input.validation) return "error";
  return input.validation.status;
}
