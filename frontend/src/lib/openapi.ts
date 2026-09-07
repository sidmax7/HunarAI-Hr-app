// Parsing for the API console. The console is driven off the backend's own live
// OpenAPI document rather than a hand-maintained list, so an endpoint added to
// FastAPI shows up here without anyone editing the frontend.

export type SchemaObject = {
  type?: string;
  title?: string;
  format?: string;
  description?: string;
  default?: unknown;
  properties?: Record<string, SchemaObject>;
  required?: string[];
  items?: SchemaObject;
  anyOf?: SchemaObject[];
  $ref?: string;
};

export type Param = {
  name: string;
  in: "path" | "query";
  required: boolean;
  schema: SchemaObject;
};

export type Operation = {
  id: string;
  method: string;
  path: string;
  summary: string;
  group: string;
  params: Param[];
  bodySchema: SchemaObject | null;
  /** True when the endpoint takes multipart/form-data, which this console can't compose. */
  fileUpload: boolean;
  /** True when the endpoint declares a body the spec doesn't describe (raw request). */
  freeformBody: boolean;
};

type RawParam = { name: string; in?: string; required?: boolean; schema?: SchemaObject };

type RawOperation = {
  summary?: string;
  operationId?: string;
  tags?: string[];
  parameters?: RawParam[];
  requestBody?: { content?: Record<string, { schema?: SchemaObject }> };
};

export type OpenApiSpec = {
  paths?: Record<string, Record<string, RawOperation>>;
  components?: { schemas?: Record<string, SchemaObject> };
};

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

/** Order the rail's groups the way the product's own navigation is ordered. */
const GROUP_ORDER = ["hiring", "search", "attendance", "agents", "webhooks", "root"];

export const GROUP_LABELS: Record<string, string> = {
  hiring: "Hiring",
  search: "Search & Reachout",
  attendance: "Attendance",
  agents: "Agents",
  webhooks: "Webhooks",
  root: "Root",
};

/**
 * FastAPI emits an optional field as `anyOf: [{type: X}, {type: "null"}]`.
 * Unwrap that to the real type so a nullable string still renders as a text field.
 */
export function baseSchema(schema: SchemaObject | undefined): SchemaObject {
  if (!schema) return {};
  if (schema.anyOf?.length) {
    const concrete = schema.anyOf.find((option) => option.type !== "null");
    if (concrete) return { ...concrete, title: schema.title, default: schema.default };
  }
  return schema;
}

function resolveSchema(spec: OpenApiSpec, schema: SchemaObject | undefined): SchemaObject | null {
  if (!schema) return null;
  if (schema.$ref) {
    const name = schema.$ref.split("/").pop();
    return (name ? spec.components?.schemas?.[name] : undefined) ?? null;
  }
  return schema;
}

/** A readable fallback when an endpoint declares no summary of its own. */
function humanize(operationId: string | undefined, method: string, path: string): string {
  if (!operationId) return `${method.toUpperCase()} ${path}`;
  const trimmed = operationId.replace(/_api_.*$/, "").replace(/_/g, " ").trim();
  if (!trimmed) return `${method.toUpperCase()} ${path}`;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function parseOperations(spec: OpenApiSpec): Operation[] {
  const operations: Operation[] = [];

  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, raw] of Object.entries(methods)) {
      if (!HTTP_METHODS.includes(method.toLowerCase())) continue;

      const content = raw.requestBody?.content ?? {};
      const jsonSchema = resolveSchema(spec, content["application/json"]?.schema);
      const fileUpload = Object.keys(content).some((type) => type.startsWith("multipart/"));
      const declaresBody = Object.keys(content).length > 0;

      operations.push({
        id: `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase(),
        path,
        summary: raw.summary ?? humanize(raw.operationId, method, path),
        group: raw.tags?.[0] ?? "root",
        params: (raw.parameters ?? [])
          .filter((param): param is RawParam & { in: "path" | "query" } => param.in === "path" || param.in === "query")
          .map((param) => ({
            name: param.name,
            in: param.in,
            required: param.required ?? param.in === "path",
            schema: param.schema ?? {},
          })),
        bodySchema: jsonSchema,
        fileUpload,
        freeformBody: declaresBody && !jsonSchema && !fileUpload,
      });
    }
  }

  return operations;
}

export function groupOperations(operations: Operation[]): { group: string; operations: Operation[] }[] {
  const byGroup = new Map<string, Operation[]>();
  for (const operation of operations) {
    const existing = byGroup.get(operation.group);
    if (existing) existing.push(operation);
    else byGroup.set(operation.group, [operation]);
  }

  return [...byGroup.entries()]
    .sort(([a], [b]) => {
      const ai = GROUP_ORDER.indexOf(a);
      const bi = GROUP_ORDER.indexOf(b);
      return (ai === -1 ? GROUP_ORDER.length : ai) - (bi === -1 ? GROUP_ORDER.length : bi);
    })
    .map(([group, ops]) => ({ group, operations: ops }));
}

/** The text a field starts out holding, from the schema's own default. */
export function defaultFieldText(schema: SchemaObject): string {
  const base = baseSchema(schema);
  if (base.default !== undefined && base.default !== null) {
    return typeof base.default === "object" ? JSON.stringify(base.default, null, 2) : String(base.default);
  }
  if (base.type === "array") return "[]";
  if (base.type === "object") return "{}";
  if (base.type === "boolean") return "false";
  return "";
}

export class FieldValueError extends Error {}

/** Turn a field's text back into the JSON type the endpoint declared. */
export function coerceFieldValue(schema: SchemaObject, name: string, text: string): unknown {
  const base = baseSchema(schema);
  switch (base.type) {
    case "integer":
    case "number": {
      const parsed = Number(text);
      if (!Number.isFinite(parsed)) throw new FieldValueError(`${name} must be a number.`);
      return parsed;
    }
    case "boolean":
      return text === "true";
    case "array":
    case "object":
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new FieldValueError(`${name} must be valid JSON.`);
      }
    default:
      return text;
  }
}
