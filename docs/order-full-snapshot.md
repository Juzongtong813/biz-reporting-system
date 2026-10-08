# Order Full Snapshot Imports

Normal uploads represent the complete order ledger. A successful import replaces
all previously current order rows in one transaction. Previous batches and raw
rows remain available by batch ID for audit. Failed imports preserve current data.

Limits: one worksheet, 34-column order template, 50 MiB, 300,000 data rows.
Purchase order numbers can have multiple material or site lines; imports preserve
these lines without deduplicating by purchase order number.

Normal uploads require the all-data scope. Correction uploads apply only to rows
in the current snapshot and preserve the existing replacement chain. A database
lock serializes snapshot activation, corrections and row maintenance. An older
upload cannot replace a newer activated normal upload.

Contract totals, aggregates, fee-rate recalculation and analysis snapshot builds
filter is_current=1. Activation invalidates ready analysis snapshots so supported
views use their existing live-data fallback until a new analysis snapshot is built.

Migration 030 preserves all existing rows as current for compatibility: historical
split imports remain effective until the first successful full-ledger upload.
Do not select one historical split batch as the complete ledger during migration.

Verification: type checking, production build, migration checksums, isolated
SQLite service tests and desktop/mobile Playwright checks. The supplied workbook
was parsed and persisted as 212,024 rows in an isolated database in 98.329 seconds,
using about 3,748 MiB RSS. This proves parsing and persistence, not production
contract/city mappings. The legacy M4 HTTP test currently stops with HTTP 401
while creating its test accounts, before order assertions.

CloudRun requires sufficient memory for this workbook (4 CPU / 8 GiB configured)
and a minimum running instance to support the existing in-process import job.
Process crashes can still interrupt an in-process job; durable job resumption is
outside this change. Do not manually terminate instances during an import.
