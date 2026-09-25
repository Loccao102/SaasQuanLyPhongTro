import { inspectSePayReadiness } from "../src/modules/integrations/sepay-readiness.js";

const report = inspectSePayReadiness(process.env);

process.stdout.write(
  JSON.stringify(
    {
      status: report.ready ? "ready" : "blocked",
      reconciliationEnabled: report.reconciliationEnabled,
      previousWebhookSecretConfigured:
        report.previousWebhookSecretConfigured,
      issues: report.issues
    },
    null,
    2
  ) + "\n"
);

if (!report.ready) {
  process.exitCode = 1;
}
