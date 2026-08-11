import "server-only";
import { trace, type Tracer } from "@opentelemetry/api";
import { NodeTracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

/**
 * specs/07-observability.md — OpenTelemetry spans exported to a Microsoft
 * Foundry project. Additive only: if AZURE_FOUNDRY_OTLP_ENDPOINT /
 * AZURE_FOUNDRY_API_KEY aren't configured, spans are still created and ended
 * normally by every call site (so instrumentation code never has to branch on
 * whether Foundry is configured) — they're just never exported anywhere. A
 * BatchSpanProcessor is used specifically so export happens off the
 * request-latency-critical path, per specs/07's Edge Cases.
 */

const SERVICE_NAME = "rflx-gateway";

let provider: NodeTracerProvider | undefined;

function getProvider(): NodeTracerProvider {
  if (provider) return provider;

  provider = new NodeTracerProvider({
    resource: new Resource({ [ATTR_SERVICE_NAME]: SERVICE_NAME }),
  });

  const endpoint = process.env.AZURE_FOUNDRY_OTLP_ENDPOINT;
  const apiKey = process.env.AZURE_FOUNDRY_API_KEY;

  if (endpoint && apiKey) {
    const exporter = new OTLPTraceExporter({
      url: endpoint,
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    provider.addSpanProcessor(new BatchSpanProcessor(exporter));
  }

  provider.register();
  return provider;
}

export function getTracer(): Tracer {
  return getProvider().getTracer(SERVICE_NAME);
}

/** True once at least one export destination is wired up — informational only. */
export function isForwardingToFoundry(): boolean {
  return Boolean(process.env.AZURE_FOUNDRY_OTLP_ENDPOINT && process.env.AZURE_FOUNDRY_API_KEY);
}

export { trace };
