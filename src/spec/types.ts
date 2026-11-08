export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export interface OperationParam {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required: boolean;
  description?: string;
  schema?: unknown;
}

export interface Operation {
  id: string;
  product: string;
  api: string;
  method: HttpMethod;
  path: string;
  summary: string;
  description?: string;
  write: boolean;
  health: boolean;
  scopes: string[];
  clientSecretHeader: boolean;
  params: OperationParam[];
  /** partTypes: the content type each multipart part must have, where the spec declares one. */
  body?: { required: boolean; contentTypes: string[]; schema?: unknown; partTypes?: Record<string, string> };
  servers: { production?: string; sandbox?: string };
}

export interface OperationIndex {
  generatedFrom: number;
  operations: Operation[];
}
