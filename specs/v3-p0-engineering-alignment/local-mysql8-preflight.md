# Local Isolated MySQL 8 Preflight

Date: 2026-07-30

Qualification: `LOCAL_ISOLATED_MYSQL8=PASS`, `qualification=non_gate`

This evidence verifies MySQL 8 migration compatibility on a dedicated local portable instance. It does not satisfy the external `REAL_MYSQL` gate because the instance used localhost.

## Runtime

- Package: MySQL Community Server 8.0.46 Windows x64 ZIP
- Official source: `https://cdn.mysql.com/Downloads/MySQL-8.0/mysql-8.0.46-winx64.zip`
- Archive size: `248009349` bytes
- SHA-256: `28E9EDA019D88EFF4478D811EA2110B83F02A3966BE157FE91CC55DEF3AB0D4D`
- Windows Authenticode status for `mysqld.exe`: `Valid`
- Bind address: `127.0.0.1`
- Port: `3307`
- Data root: `E:/code2/mysql8-isolated/data`
- Existing MySQL93 service on port 3306 was not stopped or modified.

The instance started with only `information_schema`, `mysql`, `performance_schema`, and `sys`. A non-root account was granted only against the escaped `biz_reporting_migration_test_%` schema namespace. Root and test passwords were generated in memory and were not persisted.

## Test Result

The repository migration harness was copied outside the repository with a local-only, `non_gate` host adapter. The release harness itself continues to reject localhost, root users, empty passwords, and production mode.

Final result:

- `PRECHECK_OK dialect=mysql migrations=9`
- 001 through 008 applied with `execution_mode=executed`, including both 002 files.
- Nine migration ledger rows matched frozen SHA-256 checksums.
- 007 generated column, single-root unique index, invitation indexes, and foreign keys passed.
- 008 lifecycle columns, indexes, and self-referencing foreign keys passed.
- A second migration run was idempotent and left the ledger unchanged.
- Forced failure at 005 produced the expected failed ledger row.
- Both random schemas were dropped by the harness.
- `LOCAL_ISOLATED_MYSQL8_TEST_EXIT=0`
- `MYSQL8_ISOLATED_SHUTDOWN_EXIT=0`
- Port 3307 was not accepting connections after shutdown.

## Harness Fix

The first structural assertion exposed a test-only compatibility defect: MySQL `information_schema` result fields were accessed through lowercase mysql2 properties without explicit aliases. `scripts/test/run-migrations-mysql.mjs` now aliases the inspected fields explicitly. No migration SQL or migration checksum changed.

## Gate Status

- `LOCAL_ISOLATED_MYSQL8=PASS`
- `REAL_MYSQL=BLOCKED`
- `GIT_RELEASE_TRACEABILITY=BLOCKED`
- `BROWSER=BLOCKED`
- `PERSISTENT_STORAGE=BLOCKED`
- `DEPLOYMENT_GATE=BLOCKED`

Closing `REAL_MYSQL` still requires the unmodified release harness to run against a non-localhost, explicitly isolated MySQL 8 environment with a non-root dedicated account.
