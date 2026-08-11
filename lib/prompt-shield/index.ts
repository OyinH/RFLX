import "server-only";
import type { SourceChannel } from "@/lib/supabase/types";

/**
 * Layer 1 — Azure AI Content Safety Prompt Shields, per specs/03-gateway-api.md
 * step 2 and docs/engineering/architecture.md's Model Choice table. Purpose-built
 * commodity injection detection; rflx consumes it, never rebuilds it
 * (docs/rflx_PRD.md's "What rflx Explicitly Is Not").
 */

const API_VERSION = "2024-09-01";
const TIMEOUT_MS = 4000;

export interface PromptShieldResult {
  injection_flag: boolean;
}

interface ShieldPromptResponse {
  userPromptAnalysis?: { attackDetected: boolean };
  documentsAnalysis?: { attackDetected: boolean }[];
}

/**
 * `direct_input` content is screened as the API's `userPrompt` — an
 * instruction directly authored by whoever submitted the action.
 * `patient_portal_message` / `ingested_document` content is screened as a
 * `document` — inbound content the agent is reading rather than authoring,
 * which is exactly Prompt Shields' distinction between a direct and an
 * indirect ("cross-domain") attack, and lines up with specs/08-eval-harness.md's
 * `indirect_portal_message` attack vector.
 */
export async function screenForInjection(
  content: string,
  sourceChannel: SourceChannel,
): Promise<PromptShieldResult> {
  const endpoint = process.env.AZURE_CONTENT_SAFETY_ENDPOINT;
  const key = process.env.AZURE_CONTENT_SAFETY_KEY;
  if (!endpoint || !key) {
    throw new Error(
      "AZURE_CONTENT_SAFETY_ENDPOINT / AZURE_CONTENT_SAFETY_KEY are not configured — see .env.local.example.",
    );
  }

  const isInboundContent = sourceChannel !== "direct_input";
  const body = isInboundContent ? { userPrompt: "", documents: [content] } : { userPrompt: content, documents: [] };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${endpoint.replace(/\/$/, "")}/contentsafety/text:shieldPrompt?api-version=${API_VERSION}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": key,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Prompt Shield request timed out after ${TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Prompt Shield request failed: ${response.status} ${detail}`);
  }

  const result = (await response.json()) as ShieldPromptResponse;
  const injection_flag =
    Boolean(result.userPromptAnalysis?.attackDetected) ||
    Boolean(result.documentsAnalysis?.some((doc) => doc.attackDetected));

  return { injection_flag };
}
