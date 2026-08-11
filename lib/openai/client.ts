import "server-only";
import OpenAI from "openai";

let client: OpenAI | undefined;

/**
 * OpenAI client for the investigator (docs/engineering/architecture.md's
 * Model Choice table) — Next.js server-context only. The mock agent simulator
 * (specs/00-mock-agent-simulator.md) and eval case generation run as standalone
 * scripts outside Next.js's bundler, where the "server-only" guard above would
 * throw on import (it only no-ops under Next.js's "react-server" resolution
 * condition) — they use scripts/lib/openai-client.ts instead, a deliberate
 * near-duplicate for that different execution context, not an oversight.
 */
// The SDK's own default (10 minutes) is far too loose for a system with a 3s
// P95 target — verified live: without an explicit timeout, a handful of
// investigation turns during a slow period on OpenAI's end compounded into
// single requests taking 6-75 minutes (two of them then failing outright).
// 20s bounds a single call generously relative to that target while still
// giving a reasoning-model call real room; specs/04's investigator loop caps
// at 8 turns, so worst case is bounded (~8x this), not unbounded.
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
