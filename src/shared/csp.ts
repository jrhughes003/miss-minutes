// The Content Security Policy, shared by two places:
// - the desktop app sends it as a response header (electron/security.ts);
// - the built HTML carries it as a meta tag (vite.config.ts). The web demo has
//   no main process to add a header, so this tag is its only policy.
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  // The renderer never talks to the network: Google, Anthropic and everything
  // else goes through the main process.
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')
