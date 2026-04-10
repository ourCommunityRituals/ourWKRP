/**
 * Validation middleware — Zod schemas → structured 400 errors
 *
 * Returns actionable error messages with field paths so the
 * frontend can highlight exactly what's wrong.
 */

import { type ZodSchema } from 'zod';

/**
 * Validate a request body against a Zod schema.
 * Returns the parsed data or a 400 Response with field errors.
 */
export async function validateBody<T>(
  request: Request,
  schema: ZodSchema<T>,
): Promise<T | Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({
      ok: false,
      error: 'Invalid JSON in request body',
      field_errors: {},
    }, { status: 400 });
  }

  return validateData(raw, schema);
}

/**
 * Validate query params against a Zod schema.
 * Converts URLSearchParams to a plain object first.
 */
export function validateQuery<T>(
  url: URL,
  schema: ZodSchema<T>,
): T | Response {
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });

  return validateData(params, schema);
}

/**
 * Validate arbitrary data against a Zod schema.
 * Returns parsed data or a structured 400 error response.
 */
function validateData<T>(
  data: unknown,
  schema: ZodSchema<T>,
): T | Response {
  const result = schema.safeParse(data);

  if (result.success) {
    return result.data;
  }

  // Build field-level error map
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : '_root';
    if (!fieldErrors[path]) fieldErrors[path] = [];
    fieldErrors[path].push(issue.message);
  }

  // Build a human-readable summary from the first error
  const firstIssue = result.error.issues[0];
  const fieldName = firstIssue.path.length > 0 ? firstIssue.path.join('.') : 'input';
  const summary = `${fieldName}: ${firstIssue.message}`;

  return Response.json({
    ok: false,
    error: summary,
    field_errors: fieldErrors,
  }, { status: 400 });
}
