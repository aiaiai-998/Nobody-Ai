import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Serves api/chat.ts on the dev server so `npm run dev` behaves like a real
 * deployment. Without this the only way to exercise the proxy is to deploy it,
 * which makes the key-free path impossible to test locally.
 *
 * Put the key in .env.local (gitignored) to try it:
 *
 *   GEMINI_API_KEY=your-key
 *   VITE_PROXY_URL=/api/chat
 *
 * Leave VITE_PROXY_URL unset and the app keeps its bring-your-own-key
 * behaviour — the middleware is harmless either way.
 */
function proxyDevPlugin(): Plugin {
  return {
    name: 'kian-ai:proxy-dev',
    configureServer(server) {
      server.middlewares.use('/api/chat', (req: IncomingMessage, res: ServerResponse) => {
        let raw = ''
        req.on('data', (chunk) => {
          raw += chunk
        })
        req.on('end', () => {
          void (async () => {
            const { default: handler } = await import('./api/chat.ts')
            const headers: Record<string, string> = {}
            for (const [name, value] of Object.entries(req.headers)) {
              if (typeof value === 'string') headers[name] = value
            }
            let body: unknown = {}
            try {
              body = raw ? JSON.parse(raw) : {}
            } catch {
              // Fall through with an empty body; the handler reports it.
            }
            await handler(
              {
                method: req.method,
                body,
                headers,
                socket: { remoteAddress: req.socket.remoteAddress },
              },
              res as never,
            )
          })()
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), proxyDevPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true, // Allow e2b preview host
  },
})
