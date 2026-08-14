import "server-only";
import { trace, type Tracer, diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";

// OTel JS silently swallows exporter errors (auth failure, network error,
// malformed connection string) with no diag logger configured — a documented
// SDK behavior, not something specific to this exporter. ERROR level only,
// so normal operation stays quiet; this exists purely so a broken/expired
// connection string doesn't fail silently forever.
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);
import { NodeTracerProvider, BatchSpanProcessor, type SpanProcessor } from "@opentelemetry/sdk-trace-node";
import { AzureMonitorTraceExporter } from "@azure/monitor-opentelemetry-exporter";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

/**
 * specs/07-observability.md — OpenTelemetry spans exported to a Microsoft
 * Foundry project. Additive only: if AZURE_FOUNDRY_CONNECTION_STRING isn't
 * configured, spans are still created and ended normally by every call site
 * (so instrumentation code never has to branch on whether Foundry is
 * configured) — they're just never exported anywhere. A BatchSpanProcessor
 * is used specifically so export happens off the request-latency-critical
 * path, per specs/07's Edge Cases.
 *
 * Foundry ingests traces via the Application Insights resource linked to the
 * Foundry project, through the Azure Monitor OpenTelemetry exporter — not a
 * generic OTLP/HTTP endpoint with a bearer token, which is what an earlier
 * version of this file assumed before that was verified against current
 * Microsoft Learn docs. The credential is a connection string (Project >
 * Tracing > Manage data source > Connection string in the Foundry portal),
 * not a URL + API key pair.
 */

const SERVICE_NAME = "rflx-gateway";

let provider: NodeTracerProvider | undefined;

function getProvider(): NodeTracerProvider {
  if (provider) return provider;

  const connectionString = process.env.AZURE_FOUNDRY_CONNECTION_STRING;

  // OTel JS v2's NodeTracerProvider takes spanProcessors in its constructor
  // config rather than via a post-construction addSpanProcessor() call
  // (removed in v2 — see doc/upgrade-to-2.x.md in open-telemetry/opentelemetry-js).
  const spanProcessors: SpanProcessor[] = connectionString
    ? [new BatchSpanProcessor(new AzureMonitorTraceExporter({ connectionString }))]
    : [];

  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: SERVICE_NAME }),
    spanProcessors,
  });

  provider.register();
  return provider;
}

export function getTracer(): Tracer {
  return getProvider().getTracer(SERVICE_NAME);
}

/** True once the export destination is wired up — informational only. */
export function isForwardingToFoundry(): boolean {
  return Boolean(process.env.AZURE_FOUNDRY_CONNECTION_STRING);
}

export { trace };
