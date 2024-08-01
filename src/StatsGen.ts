import logger from "./logger";
import dotenv from "dotenv";
import { ContractsPerChain, Manifest, Stats } from "./types";
import { Pool, QueryResult } from "pg";
import { writeFile } from "fs/promises";

dotenv.config();

export default class StatsGen {
  private databasePool?: Pool;

  constructor() {
    if (
      !process.env.POSTGRES_HOST ||
      !process.env.POSTGRES_DATABASE ||
      !process.env.POSTGRES_USER ||
      !process.env.POSTGRES_PASSWORD ||
      !process.env.REPOV1_PATH ||
      !process.env.REPOV2_PATH
    ) {
      throw new Error("One or more required environment variables are missing");
    }
  }

  async init(): Promise<boolean> {
    // if the database is already initialized
    if (this.databasePool != undefined) {
      return true;
    }

    logger.debug(`Initializing database pool`);

    this.databasePool = new Pool({
      host: process.env.POSTGRES_HOST,
      port: parseInt(process.env.POSTGRES_PORT || "5432"),
      database: process.env.POSTGRES_DATABASE,
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      max: 5,
    });

    // Checking pool health before continuing
    try {
      logger.debug(`Checking database pool health`);
      await this.databasePool.query("SELECT 1;");
    } catch (error) {
      logger.error(`Cannot connect`, {
        host: process.env.POSTGRES_HOST,
        port: process.env.POSTGRES_PORT,
        database: process.env.POSTGRES_DATABASE,
        user: process.env.POSTGRES_USER,
        error,
      });
      throw new Error(`Cannot connect`);
    }

    logger.info(`Database initialized`, {
      host: process.env.POSTGRES_HOST,
      port: process.env.POSTGRES_PORT,
      database: process.env.POSTGRES_DATABASE,
      user: process.env.POSTGRES_USER,
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
      logger.error("Error while querying database", {
        error,
      });
      throw new Error("Error while querying database");
    }
    logger.info("Count completed");

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
    this.databasePool?.end();
  }

  async countContractsPerChain(): Promise<ContractsPerChain[]> {
    if (!this.databasePool) {
      throw new Error("Database pool is not initialized");
    }

    const query = `
      SELECT
        contract_deployments.chain_id AS chain_id,
        CAST(SUM(CASE 
          WHEN COALESCE(sourcify_matches.creation_match, '') = 'perfect' OR sourcify_matches.runtime_match = 'perfect' THEN 1 ELSE 0 END) AS INTEGER) AS full,
        CAST(SUM(CASE 
          WHEN COALESCE(sourcify_matches.creation_match, '') != 'perfect' AND sourcify_matches.runtime_match != 'perfect' THEN 1 ELSE 0 END) AS INTEGER) AS partial
      FROM sourcify_matches
      JOIN verified_contracts ON verified_contracts.id = sourcify_matches.verified_contract_id
      JOIN contract_deployments ON contract_deployments.id = verified_contracts.deployment_id
      GROUP BY contract_deployments.chain_id;
    `;

    const result: QueryResult<ContractsPerChain> =
      await this.databasePool.query(query);
    return result.rows;
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
