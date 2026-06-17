/**
 * Rison encoder for Apache Superset API query parameters.
 *
 * Rison is a compact, URI-friendly alternative to JSON used by Superset's
 * REST API for the `q` parameter on list/info endpoints.
 *
 * @see https://rison.io
 */

/** Union type for all values that can be encoded as Rison. */
export type RisonValue =
  | string
  | number
  | boolean
  | null
  | RisonValue[]
  | { [key: string]: RisonValue };

/**
 * Encode a JavaScript value into Rison format.
 *
 * Encoding rules:
 * - null       → !n
 * - true/false → !t / !f
 * - number     → String(number)
 * - string     → 'value' (always quoted; internal single quotes escaped as !')
 * - array      → !(item,item,...)
 * - object     → (key:value,key:value,...)
 */
export function encodeRison(value: RisonValue): string {
  if (value === null) {
    return "!n";
  }
  if (typeof value === "boolean") {
    return value ? "!t" : "!f";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    // Always use single-quoted strings for consistency with Superset API expectations
    return `'${value.replace(/'/g, "!'")}'`;
  }
  if (Array.isArray(value)) {
    const items = value.map(encodeRison).join(",");
    return `!(${items})`;
  }
  // Plain object
  const pairs = Object.entries(value)
    .map(([k, v]) => `${k}:${encodeRison(v)}`)
    .join(",");
  return `(${pairs})`;
}
