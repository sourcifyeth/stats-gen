import logger from "./logger";
import dotenv from "dotenv";
import { ContractsPerChain, Manifest, Stats } from "./types";
import { BigQuery } from "@google-cloud/bigquery";
import { readFile, writeFile } from "fs/promises";

dotenv.config();

const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const DATASET_PATTERN = /^[A-Za-z0-9_]+$/;
const DEFAULT_LOCATION = "europe-west1";
const DEFAULT_MAX_BYTES_BILLED = "10000000000";
// The new total must not be lower than this share of the old total.
export const MIN_TOTAL_RATIO = 0.9;

export interface BigQueryConfig {
  projectId?: string;
  dataset: string;
  location: string;
  maximumBytesBilled: string;
}

export function readBigQueryConfig(
  env: NodeJS.ProcessEnv = process.env
): BigQueryConfig {
  const dataset = env.BIGQUERY_DATASET;
  if (!dataset) {
    throw new Error("BIGQUERY_DATASET is missing");
  }
  if (!DATASET_PATTERN.test(dataset)) {
    throw new Error("BIGQUERY_DATASET has invalid characters");
  }

  const projectId = env.BIGQUERY_PROJECT_ID || undefined;
  if (projectId !== undefined && !PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error("BIGQUERY_PROJECT_ID has invalid characters");
  }

  const maximumBytesBilled =
    env.BIGQUERY_MAX_BYTES_BILLED || DEFAULT_MAX_BYTES_BILLED;
  if (!/^[1-9][0-9]*$/.test(maximumBytesBilled)) {
    throw new Error("BIGQUERY_MAX_BYTES_BILLED must be a positive integer");
  }

  return {
    projectId,
    dataset,
    location: env.BIGQUERY_LOCATION || DEFAULT_LOCATION,
    maximumBytesBilled,
  };
}

export function buildCountQuery(projectId: string, dataset: string): string {
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error("Project id has invalid characters");
  }
  if (!DATASET_PATTERN.test(dataset)) {
    throw new Error("Dataset has invalid characters");
  }
  return `
    SELECT
      chain_id,
      COUNTIF(COALESCE(creation_match, '') = 'perfect' OR runtime_match = 'perfect') AS full_match,
      COUNTIF(COALESCE(creation_match, '') != 'perfect' AND runtime_match != 'perfect') AS partial_match
    FROM \`${projectId}.${dataset}.public_sourcify_matches\`
    GROUP BY chain_id
  `;
}

export interface CountRow {
  chain_id: unknown;
  full_match: unknown;
  partial_match: unknown;
}

// The client can return INT64 as a number, a string or a wrapped value.
export function mapCountRows(rows: CountRow[]): ContractsPerChain[] {
  const result: ContractsPerChain[] = [];
  for (const row of rows) {
    if (row.chain_id === null || row.chain_id === undefined) {
      logger.warn("Skipping row without chain_id", { row });
      continue;
    }
    const chainId = Number(row.chain_id);
    const full = Number(row.full_match);
    const partial = Number(row.partial_match);
    if (!Number.isFinite(chainId) || !Number.isFinite(full) || !Number.isFinite(partial)) {
      throw new Error(`Row has non-numeric values: ${JSON.stringify(row)}`);
    }
    result.push({ chain_id: chainId, full, partial });
  }
  return result;
}

export function sumContracts(contractsPerChain: ContractsPerChain[]): number {
  return contractsPerChain.reduce(
    (total, chain) => total + chain.full + chain.partial,
    0
  );
}

export function sumStats(stats: Stats): number {
  let total = 0;
  for (const entry of Object.values(stats)) {
    total += Number(entry?.full_match) || 0;
    total += Number(entry?.partial_match) || 0;
  }
  return total;
}

// Guard 1: an empty result must not overwrite the published files.
export function assertNotEmpty(contractsPerChain: ContractsPerChain[]): void {
  if (contractsPerChain.length === 0) {
    throw new Error("Query returned zero rows");
  }
  if (sumContracts(contractsPerChain) === 0) {
    throw new Error("Query returned a total of zero contracts");
  }
}

// Guard 2: a large drop of the total must not overwrite the published files.
export function assertNoLargeDrop(
  newTotal: number,
  previousTotal: number | undefined
): void {
  if (previousTotal === undefined) {
    return;
  }
  if (newTotal < previousTotal * MIN_TOTAL_RATIO) {
    throw new Error(
      `New total ${newTotal} is below ${MIN_TOTAL_RATIO * 100}% of previous total ${previousTotal}`
    );
  }
}

// Returns undefined when the file does not exist or does not parse.
export async function readPreviousTotal(
  statsPath: string
): Promise<number | undefined> {
  let content: string;
  try {
    content = await readFile(statsPath, "utf8");
  } catch (error) {
    logger.info("No previous stats file found", { statsPath });
    return undefined;
  }
  try {
    const stats = JSON.parse(content);
    if (stats === null || typeof stats !== "object") {
      throw new Error("Stats file is not an object");
    }
    return sumStats(stats);
  } catch (error) {
    logger.warn("Previous stats file does not parse", { statsPath, error });
    return undefined;
  }
}

export default class StatsGen {
  private bigquery?: BigQuery;
  private config: BigQueryConfig;

  constructor() {
    if (!process.env.REPOV1_PATH || !process.env.REPOV2_PATH) {
      throw new Error("REPOV1_PATH or REPOV2_PATH is missing");
    }
    this.config = readBigQueryConfig();
  }

  async init(): Promise<boolean> {
    if (this.bigquery != undefined) {
      return true;
    }

    logger.debug(`Initializing BigQuery client`);
    this.bigquery = new BigQuery({
      projectId: this.config.projectId,
      location: this.config.location,
    });

    if (!this.config.projectId) {
      this.config.projectId = await this.bigquery.getProjectId();
    }

    logger.info(`BigQuery client initialized`, {
      projectId: this.config.projectId,
      dataset: this.config.dataset,
      location: this.config.location,
      maximumBytesBilled: this.config.maximumBytesBilled,
    });
    return true;
  }

  async start() {
    await this.init();

    logger.info("Count contracts in each chain");
    let contractsPerChain: ContractsPerChain[];
    try {
      contractsPerChain = await this.countContractsPerChain();
    } catch (error: any) {
      logger.error("Error while querying BigQuery", {
        error,
      });
      throw new Error("Error while querying BigQuery");
    }
    logger.info("Count completed");

    assertNotEmpty(contractsPerChain);
    const newTotal = sumContracts(contractsPerChain);
    const previousTotal = await readPreviousTotal(
      `${process.env.REPOV2_PATH}/stats.json`
    );
    assertNoLargeDrop(newTotal, previousTotal);
    logger.info("Totals", {
      chains: contractsPerChain.length,
      newTotal,
      previousTotal,
    });

    logger.info("Formatting results in stats.json");
    let stats;
    try {
      stats = this.generateStats(contractsPerChain);
    } catch (error: any) {
      logger.error("Error while generating stats", {
        contractsPerChain,
        error,
      });
      throw new Error("Error while generating stats");
    }

    logger.info("Formatting results in manifest.json");
    let manifestV1: Required<Manifest>;
    let manifestV2: Required<Manifest>;
    try {
      const manifest = this.generateManifest();
      manifestV1 = { ...manifest, version: "1" };
      manifestV2 = { ...manifest, version: "2" };
    } catch (error: any) {
      logger.error("Error while generating manifest", {
        contractsPerChain,
        error,
      });
      throw new Error("Error while generating manifest");
    }

    logger.info("Storing files");
    try {
      await this.storeFilesInRepo(stats, manifestV1, manifestV2);
    } catch (error: any) {
      logger.error("Error while storing files in repo", {
        stats,
        manifestV1,
        manifestV2,
        error,
      });
      throw new Error("Error while storing files in repo");
    }
  }

  async close() {
    // The BigQuery client has no open connection to close.
    this.bigquery = undefined;
  }

  async countContractsPerChain(): Promise<ContractsPerChain[]> {
    if (!this.bigquery || !this.config.projectId) {
      throw new Error("BigQuery client is not initialized");
    }

    const query = buildCountQuery(this.config.projectId, this.config.dataset);
    const [job] = await this.bigquery.createQueryJob({
      query,
      location: this.config.location,
      maximumBytesBilled: this.config.maximumBytesBilled,
      useLegacySql: false,
    });
    const [rows] = await job.getQueryResults();
    const [metadata] = await job.getMetadata();
    logger.info("Query job completed", {
      jobId: job.id,
      totalBytesBilled: metadata?.statistics?.query?.totalBytesBilled,
      totalBytesProcessed: metadata?.statistics?.query?.totalBytesProcessed,
    });

    return mapCountRows(rows as CountRow[]);
  }

  generateStats(contractsPerChain: ContractsPerChain[]): Stats {
    const stats: Stats = {};
    contractsPerChain.forEach((chain) => {
      stats[chain.chain_id] = {
        full_match: chain.full,
        partial_match: chain.partial,
      };
    });
    return stats;
  }

  generateManifest(): Manifest {
    const timestamp = Date.now();
    const dateString = new Date(timestamp).toISOString();
    return {
      timestamp,
      dateString,
    };
  }

  async storeFilesInRepo(
    stats: Stats,
    manifestV1: Required<Manifest>,
    manifestV2: Required<Manifest>
  ) {
    const repoV1Path = process.env.REPOV1_PATH;
    const repoV2Path = process.env.REPOV2_PATH;

    if (!repoV1Path || !repoV2Path) {
      throw new Error("Repository paths not defined in environment variables.");
    }
    // Store stats and manifestV1 in repoV1
    await writeFile(`${repoV1Path}/stats.json`, JSON.stringify(stats, null, 2));
    await writeFile(
      `${repoV1Path}/manifest.json`,
      JSON.stringify(manifestV1, null, 2)
    );

    // Store manifestV2 in repoV2
    await writeFile(`${repoV2Path}/stats.json`, JSON.stringify(stats, null, 2));
    await writeFile(
      `${repoV2Path}/manifest.json`,
      JSON.stringify(manifestV2, null, 2)
    );
  }
}
