# Issue #265 — organization branding image selection race closure

## Verified defect

The organization settings editor used asynchronous `FileReader` conversion for
logo/favicon but allowed Save to submit the previous settings snapshot while the
new file was still pending. Multiple selections for the same field could also
resolve out of order: an earlier slow reader could replace a newer choice.
Clicking Remove while a reader was in flight could be undone by its late result.

## Fix and regression evidence

- Introduce a synchronous, field-specific generation gate for logo and favicon.
  Only the latest reader may commit a result; stale success/error callbacks
  cannot replace a newer selection or surface a misleading error.
- Block Save while either current image reader is pending, both through a
  disabled bilingual button and an immediate guard in the submit handler.
- Cancel prior pending image selection when Remove is used; prevent uploads
  and image removal during a settings network request.
- Explicitly handle `FileReader.onabort` and preserve the existing 1 MiB
  client bound, server-side image validation, settings revision conflict gate,
  transactional audit, and uncertain network retry behavior.
- Executable state-machine regression tests cover pending submit, reversed
  completion, independent simultaneous fields, and removal invalidation.
  Source-contract assertions ensure the UI actually uses the tested gate.

## Boundaries

No migrations, clinical data, financial data, released reports, permissions,
reference intervals, or analyzer rules change. This is a source-level and
state-transition regression, **not** an actual 81-route private synthetic
browser review. Issue #265 remains OPEN and Issue #250 remains NO_GO;
all 88 Master Scope requirements remain binding. No real patient screenshot
or session evidence belongs in this public GitHub repository.
