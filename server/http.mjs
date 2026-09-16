import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
function equal(a, b) {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function createAPI(queue, token) {
  if (typeof token !== "string" || token.length < 32)
    throw new Error("API token must contain at least 32 characters");
  return createServer(async (req, res) => {
    const send = (status, data) => {
      res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      res.end(JSON.stringify(data));
    };
    if (req.url === "/health" && req.method === "GET")
      return send(200, { status: "ok" });
    if (!equal(req.headers.authorization ?? "", `Bearer ${token}`))
      return send(401, { error: "Authentication required" });
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "events") return send(404, { error: "Not found" });
    try {
      if (req.method === "GET" && parts.length === 1)
        return send(200, { events: queue.list() });
      if (req.method === "GET" && parts.length === 2) {
        const e = queue.get(parts[1]);
        return send(e ? 200 : 404, e ?? { error: "Not found" });
      }
      if (req.method === "POST" && parts.length === 3 && parts[2] === "retry") {
        return send(queue.retry(parts[1]) ? 200 : 409, { id: parts[1] });
      }
      if (req.method === "POST" && parts.length === 1) {
        if (!req.headers["content-type"]?.startsWith("application/json"))
          return send(415, { error: "Use application/json" });
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 65536) {
            send(413, { error: "Request exceeds 64 KB" });
            return;
          }
          chunks.push(chunk);
        }
        const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const result = queue.create(input);
        return send(result.created ? 201 : 200, result);
      }
      return send(405, { error: "Method not allowed" });
    } catch (error) {
      return send(error.code === "CONFLICT" ? 409 : 400, {
        error: error instanceof SyntaxError ? "Invalid JSON" : error.message,
      });
    }
  });
}
