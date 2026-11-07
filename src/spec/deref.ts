// Inline local "#/..." $refs so each operation is self-contained in the index.
// Cycles and depth beyond MAX_DEPTH are cut to {"$ref": name} so it always terminates.

export const MAX_DEPTH = 12;

type Json = unknown;

export function resolvePointer(root: Json, ref: string): Json {
  if (!ref.startsWith("#/")) return undefined;
  let cur: Json = root;
  for (const raw of ref.slice(2).split("/")) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, Json>)[key];
  }
  return cur;
}

export function deref(node: Json, root: Json, seen: string[] = [], depth = 0): Json {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((n) => deref(n, root, seen, depth + 1));
  const obj = node as Record<string, Json>;
  const ref = obj.$ref;
  if (typeof ref === "string") {
    const name = ref.split("/").pop() ?? ref;
    if (seen.includes(ref) || depth >= MAX_DEPTH) return { $ref: name };
    const target = resolvePointer(root, ref);
    if (target === undefined) return { $ref: name, unresolved: true };
    return deref(target, root, [...seen, ref], depth + 1);
  }
  // fromEntries defines own properties, so a "__proto__" key in a spec cannot pollute the prototype.
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, deref(v, root, seen, depth + 1)]));
}
