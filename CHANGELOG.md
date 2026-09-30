# Changelog for `stats-gen`

All notable changes to this project will be documented in this file.

## sourcify-stats@1.1.0 - 2026-09-30

- Read the per-chain counts from the BigQuery mirror of the database with one
  single-table query. The job no longer connects to Postgres.
- Add two guards: the job does not write the files when the result is empty or
  when the new total is lower than 90 % of the old total.
- Exit with a non-zero code on any error.
- Add tests with the Node test runner (`npm test`).
- Replace the `POSTGRES_*` variables with `BIGQUERY_DATASET`,
  `BIGQUERY_PROJECT_ID`, `BIGQUERY_LOCATION` and `BIGQUERY_MAX_BYTES_BILLED`.
- Document the intended schedule of every 6 hours.

## sourcify-stats@1.0.0 - 2024-08-01

No changes this release. This marks the start of the changelog for this service
