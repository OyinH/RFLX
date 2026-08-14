import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // OpenTelemetry's packages (lib/observability/tracer.ts) don't bundle
  // cleanly under webpack's production build — verified live: `next start`
  // failed outright with "Cannot find module './vendor-chunks/@opentelemetry.js'".
  // Marking them external makes Next.js require() them directly at runtime
  // instead of bundling, which is the documented fix for this class of
  // Node-native/dynamic-require package.
  serverExternalPackages: [
    "@opentelemetry/api",
    "@opentelemetry/sdk-trace-node",
    "@opentelemetry/sdk-trace-base",
    "@azure/monitor-opentelemetry-exporter",
    "@opentelemetry/resources",
    "@opentelemetry/semantic-conventions",
  ],
  // lib/investigator/index.ts reads prompts/investigator_v1.md via fs at
  // runtime rather than importing it (specs/04's "never inlined" rule) — it
  // isn't otherwise part of the module graph, so the serverless build won't
  // trace/include it without this. Without it, the file is present in local
  // dev (reads straight from disk) but missing after a deployed build.
  outputFileTracingIncludes: {
    "/api/agent/action-request": ["./prompts/**"],
  },
};

export default nextConfig;
