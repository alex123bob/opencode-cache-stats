// src/dashboard/server.ts
import { createServer, IncomingMessage, ServerResponse } from "node:http"
import { readFileSync, watch }                            from "node:fs"
import { join, extname }                                  from "node:path"
import { fileURLToPath }                                  from "node:url"
import { readAndAggregate }                               from "./reader.js"

const __dirname = fileURLToPath(new URL(".", import.meta.url))

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js":   "text/javascript",
  ".css":  "text/css",
  ".json": "application/json",
}

export type ServerOptions = {
  jsonlPath:     string
  preferredPort: number
  autoOpen:      boolean
}

export async function startDashboardServer(opts: ServerOptions): Promise<{ url: string }> {
  const port = await findFreePort(opts.preferredPort)
  const data = () => JSON.stringify(readAndAggregate(opts.jsonlPath))

  // SSE clients
  const clients = new Set<ServerResponse>()

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/"

    // SSE stream
    if (url === "/api/stream") {
      res.writeHead(200, {
        "Content-Type":  "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection":    "keep-alive",
        "Access-Control-Allow-Origin": "*",
      })
      res.write(`data: ${data()}\n\n`)
      clients.add(res)
      req.on("close", () => clients.delete(res))
      return
    }

    // JSON snapshot
    if (url === "/api/data") {
      const body = data()
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(body)
      return
    }

    // Static SPA files
    const uiDir    = join(__dirname, "ui")
    const filePath = url === "/" ? join(uiDir, "index.html") : join(uiDir, url.replace(/^\//, ""))
    try {
      const content = readFileSync(filePath)
      const ext     = extname(filePath)
      res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" })
      res.end(content)
    } catch {
      res.writeHead(404)
      res.end("Not found")
    }
  })

  await new Promise<void>(resolve => server.listen(port, "127.0.0.1", resolve))

  // Watch JSONL for changes and push to SSE clients
  try {
    watch(opts.jsonlPath, () => {
      const snapshot = `data: ${data()}\n\n`
      for (const client of clients) {
        try { client.write(snapshot) } catch { clients.delete(client) }
      }
    })
  } catch {
    // file may not exist yet — that's fine, dashboard still works
  }

  const url = `http://localhost:${port}`
  return { url }
}

// ── Port helpers ─────────────────────────────────────────────────────────────

async function findFreePort(start: number, maxTries = 10): Promise<number> {
  for (let i = 0; i < maxTries; i++) {
    const port = start + i
    if (i > 0) console.log(`  Port ${start + i - 1} in use, trying ${port}...`)
    if (await isPortFree(port)) return port
  }
  throw new Error(`No free port found in range ${start}–${start + maxTries - 1}`)
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const s = createServer()
    s.listen(port, "127.0.0.1", () => { s.close(); resolve(true) })
    s.on("error", () => resolve(false))
  })
}
