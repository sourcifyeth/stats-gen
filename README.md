# stats-gen

Service to generate sourcify chain stats.

The job counts the full and partial matches per chain in the BigQuery mirror
of the Sourcify database and writes `stats.json` and `manifest.json` into the
repository paths. It does not connect to the Postgres database.

## Env variables

| Variable | Required | Meaning |
|---|---|---|
| `BIGQUERY_DATASET` | yes | Dataset of the mirror, for example `sourcify` or `sourcify_staging` |
| `BIGQUERY_PROJECT_ID` | no | Project of the dataset. Default: the project of the credentials |
| `BIGQUERY_LOCATION` | no | Location of the dataset. Default: `europe-west1` |
| `BIGQUERY_MAX_BYTES_BILLED` | no | Safety limit per query in bytes. Default: `10000000000` (10 GB) |
| `REPOV1_PATH` | yes | Path to repositoryV1 |
| `REPOV2_PATH` | yes | Path to repositoryV2 |

Authentication uses Application Default Credentials. The service account needs
`roles/bigquery.jobUser` on the project and `roles/bigquery.dataViewer` on the
dataset.

## Schedule

One start makes one run. A Cloud Scheduler trigger starts the job every 6 hours
(cron `15 */6 * * *`, UTC). Set the retries of the job to 0, so a failed run
waits for the next schedule.

## Running locally

1. Copy .env.template to .env and fill values

2. Log in with Application Default Credentials

```
gcloud auth application-default login
```

3. Install dependencies

```
npm install
```

4. Build

```
npm run build
```

5. Run

```
npm start
```

## Tests

```
npm test
```

## Running locally with Docker

1. Build image

```
docker build -t statsgen .
```

2. Run container

```
docker run -v /path/to/sourcify/repositories:/repositories -v ~/.config/gcloud:/root/.config/gcloud:ro -e BIGQUERY_DATASET=sourcify_staging -e REPOV1_PATH=/repositories/repoV1 -e REPOV2_PATH=/repositories/repoV2 statsgen
```
