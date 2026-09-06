/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Where the server-side proxy lives, e.g. `/api/chat`.
   *
   * This is a URL, not a secret — the endpoint is public by design, and the
   * credential stays on the server. Baking it in is what makes a deployment
   * zero-setup: visitors never have to open Settings. (An API key here would be
   * a different matter; Vite inlines VITE_* values into the shipped bundle.)
   */
  readonly VITE_PROXY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
