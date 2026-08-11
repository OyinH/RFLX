import OpenAI from "openai";

/**
 * OpenAI client for standalone scripts (scripts/mock-agent, eval/) — plain
 * Node execution via tsx, outside Next.js's bundler. Deliberately does NOT
 * import "server-only": that package throws unconditionally when required
 * outside Next.js's "react-server" module resolution condition (verified —
 * it has no other way to no-op), so it can never appear in this directory's
 * dependency graph. lib/openai/client.ts is the Next.js-app equivalent used
 * by the investigator; keep both in sync if the construction logic changes.
 */
let client: OpenAI | undefined;

// Kept in sync with lib/openai/client.ts's REQUEST_TIMEOUT_MS — see that
// file's comment for why the SDK's 10-minute default isn't used here.
const REQUEST_TIMEOUT_MS = 20_000;

export function getOpenAIClient(): OpenAI {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured — see .env.local.example.");
    }
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: REQUEST_TIMEOUT_MS });
  }
  return client;
}
