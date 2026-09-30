import logger from "./logger";
import StatsGen from "./StatsGen";

async function main() {
  const statsGen = new StatsGen();
  try {
    await statsGen.start();
    logger.info("Stats generation completed successfully");
  } finally {
    await statsGen.close();
  }
}

main().catch((error) => {
  logger.error("Stats generation failed", { error });
  process.exit(1);
});
