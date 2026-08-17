# Current Deployment Status

Updated: 2026-08-18

## Temporary order uploads

The Biz Operations order-import flow stores uploaded files only in a task-scoped temporary directory. It parses the file into MySQL and deletes the temporary file on every terminal path. Business rows, batch metadata, validation results, and audit data are persisted in MySQL.

`biz-reporting-api-prod` therefore does not require `/mnt/fact-source-files`, a CloudRun volume, or a persistent source-file backup. The runtime must pass the temporary-upload lifecycle check and `/api/health/ready`.

## Isolated production resources

- CloudBase environment: `zy-data-d2g9g1ghr47ac6254`
- Production schema: `biz_reporting_prod`
- Runtime database account: `biz_prod_runtime`, limited to DML on that schema
- API service: `biz-reporting-api-prod`
- Legacy main schema and existing API services are preserved and must not be modified by this deployment.

## Release conditions

1. Configure distinct production database, JWT, and HMAC secrets on the new API service.
2. Deploy the API and verify `/api/health/live` plus `/api/health/ready` against `biz_reporting_prod`.
3. Deploy an isolated frontend path pointing to the new API.
4. Re-run the formal non-local MySQL gate and the Chromium/WebKit browser checks in an environment where those runtimes are available.
5. Complete production smoke testing and rollback rehearsal before switching production traffic.
