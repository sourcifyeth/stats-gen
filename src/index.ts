import logger from "./logger";
import StatsGen from "./StatsGen";

async function main() {
  const statsGen = new StatsGen();
  await statsGen.start();
  logger.info("Stats generation completed successfully");
  await statsGen.close();
}

main();
