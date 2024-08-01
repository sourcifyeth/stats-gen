# stats-gen

Service to generate sourcify chain stats

## Env variables

- **POSTGRES_HOST:** Database host
- **POSTGRES_DATABASE:** Database name
- **POSTGRES_USER:** Database user
- **POSTGRES_PASSWORD:** Database password
- **POSTGRES_PORT:** Database port
- **REPOV1_PATH:** Path to repositoryV1
- **REPOV2_PATH:** Path to repositoryV2

## Running locally

1. Copy .env.template to .env and fill values

2. Install dependencies

```
npm install
```

3. Build

```
npm run build
```

4. Run

```
npm start
```

## Running locally with Docker

1. Build image

```
docker build -t statsgen .
```

2. Run container

```
docker run -v /path/to/sourcify/repositories:/repositories -e POSTGRES_HOST=host.docker.internal -e POSTGRES_DATABASE=sourcify-staging -e POSTGRES_USER=xxxxx -e POSTGRES_PASSWORD=xxxxx -e POSTGRES_PORT=5432 -e REPOV1_PATH=/repositories/repoV1 -e REPOV2_PATH=/repositories/repoV2 statsgen
```
