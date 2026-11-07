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
  params: OperationParam[];
  body?: { required: boolean; contentTypes: string[]; schema?: unknown };
  servers: { production?: string; sandbox?: string };
}

export interface OperationIndex {
  generatedFrom: number;
  operations: Operation[];
}
