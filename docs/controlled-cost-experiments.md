# Controlled API cost tests

The Verify view can keep an output-free record of one configuration change.
Use it after Simulate identifies an option worth testing. It runs locally and
does not call a provider or require credentials.

1. Record the workload, ready-result rule, currency, and starting and changed
   settings. Exactly one of model, effort, prompt version, caching, or processing
   mode must differ. Confirm that the other settings and task requirements stay
   unchanged. Lock the quality thresholds before recording runs.
2. Complete the paired-output review below the test panel, or select a saved
   `ai-cost-lens-verification/1.0` JSON record. Every case needs deterministic
   checks and human outcomes for both setups.
3. Enter API costs for the same cases and execution. Include calls and retries
   on both setups, name the cost source, and confirm this is a fresh execution.
   Costs are user supplied; importing a record does not verify provider billing.
4. Keep tuning cases separate from validation cases reserved before tuning.
   Repeat the same case IDs and rules within each partition. Once validation
   starts, further tuning requires another test record.
5. Download the test JSON before leaving the page. Open saved test rebuilds all
   summaries from the locked plan and output-free case evidence. Print test
   record produces a separate printable handoff.

The `ai-cost-lens-experiment/1.0` record reports ready rates, deterministic pass
rates, optional total review minutes, and API cost per ready result for each run.
It reports distinct validation cases separately from paired observations across
repeats. Forty cases tested twice remain forty distinct cases, with eighty paired
observations. Repeated runs do not produce a pooled confidence interval.

A validation run that misses a locked quality threshold or fails to lower API
cost per ready result rejects the change. At least two fresh validation runs on
the same thirty or more cases, a declared random or systematic sample, blind
review, randomized output order, preserved quality, and lower API unit cost in
every run support **Candidate worth a finance review**. These are minimum
workflow checks, not a statistical significance claim or adoption approval.

The record rejects reused run IDs, reused nonempty source hashes, changed case
sets or rubrics within a partition, and overlapping tuning and validation case
IDs. Case content, source authenticity, configuration adherence, and independent
execution still depend on user declarations. These controls cannot detect a
renamed duplicate case or independently authenticate costs or output quality.

An attached summary belongs only to the current review with the same workload
name, currency, and illustrative status. It appears in that review's finance
memo. The workspace archive includes the separate test record. Test costs do
not populate production Actuals or change quality, policy, billing, or savings
gates. Full operating cost, human work, change cost, and production outcomes
still need their own evidence.

**Explore a caching example** uses forty invented invoice cases and two invented
API cost pairs: $0.40 to $0.22 and $0.42 to $0.23. All outcomes, review minutes,
sampling declarations, and source markers are illustrative. This demonstrates
the workflow and is not a measured provider experiment.

Saved records contain no raw outputs. They do retain case IDs, check rules,
source names, and user-entered setting and cost references; avoid entering
secrets or sensitive content in those fields. The record supports at most fifty
runs, one thousand cases per run, and a five MiB saved file.

Request-log caching findings also include an investigation guide. The guide
separates observed cache-read and cache-write coverage from possible causes.
Prefix changes, expiry, model boundaries, minimum sizes, and cache-write or
storage charges require provider-specific evidence; they are not inferred as
proven causes from a low hit rate alone.
