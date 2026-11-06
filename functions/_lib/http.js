const defaultHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

export function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: { ...defaultHeaders, ...headers },
  });
}

export function methodNotAllowed(allowed) {
  return json({ error: "Method not allowed" }, 405, { Allow: allowed.join(", ") });
}

export function assertSameOrigin(request) {
  const origin = request.headers.get("Origin");
  const expected = new URL(request.url).origin;
  return Boolean(origin && origin === expected);
}

export async function readJson(request, maxBytes = 16384) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new RequestError(415, "Expected application/json");
  }

  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > maxBytes) throw new RequestError(413, "Request body is too large");

  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new RequestError(413, "Request body is too large");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new RequestError(400, "Invalid JSON");
  }
}

export class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "RequestError";
    this.status = status;
  }
}

export function errorResponse(error, request) {
  if (error instanceof RequestError) return json({ error: error.message }, error.status);
  console.error(JSON.stringify({
    message: "trip API request failed",
    error: error instanceof Error ? error.message : String(error),
    path: new URL(request.url).pathname,
  }));
  return json({ error: "Internal server error" }, 500);
}
