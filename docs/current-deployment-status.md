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

## Verified deployment evidence

- API deployment: `biz-reporting-api-prod`, deployment `008` succeeded; deployment `009` applied the isolated frontend CORS origin with the same verified image.
- API health: `GET /api/health/live` and `GET /api/health/ready` both returned HTTP 200. Readiness reported both `database: up` and `storage: up`.
- Frontend deployment: `biz-reporting-prod`, build `2601797812`, status `SUCCESS`.
- Isolated frontend URL: `https://biz-reporting-prod-zy-data-d2g9g1ghr47ac6254.webapps.tcloudbase.com`.
- Browser smoke: the isolated frontend login page loaded and the initialized `super_admin` account completed login. The two-level portal and all business and system-management navigation entries were visible after login.
- Frontend API routing: the production bundle is configured with the isolated API base URL, rather than relying on the legacy `/api` same-origin route.

## Remaining release conditions

1. Keep the generated initial administrator password in the designated secure handoff channel and require a password change before giving the account to an operator.
2. Complete the governance-owned production rollback rehearsal and record the result before any business data import or broad user rollout.
3. Bind an approved custom domain when one is available; the current CloudBase test domain remains suitable only for controlled release validation.
