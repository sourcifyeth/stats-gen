import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  assertNoLargeDrop,
  assertNotEmpty,
  buildCountQuery,
  mapCountRows,
  readBigQueryConfig,
  readPreviousTotal,
  sumContracts,
} from "../src/StatsGen";

process.env.NODE_LOG_LEVEL = "error";

test("mapCountRows converts INT64 given as number", () => {
  const rows = mapCountRows([{ chain_id: 1, full_match: 10, partial_match: 5 }]);
  assert.deepEqual(rows, [{ chain_id: 1, full: 10, partial: 5 }]);
});

test("mapCountRows converts INT64 given as string", () => {
  const rows = mapCountRows([
    { chain_id: "11155111", full_match: "123", partial_match: "0" },
  ]);
  assert.deepEqual(rows, [{ chain_id: 11155111, full: 123, partial: 0 }]);
});

test("mapCountRows converts INT64 given as wrapped value", () => {
  const wrap = (value: string) => ({ value, valueOf: () => Number(value) });
  const rows = mapCountRows([
    { chain_id: wrap("5"), full_match: wrap("7"), partial_match: wrap("8") },
  ]);
  assert.deepEqual(rows, [{ chain_id: 5, full: 7, partial: 8 }]);
});

test("mapCountRows skips a row with null chain_id", () => {
  const rows = mapCountRows([
    { chain_id: null, full_match: 3, partial_match: 4 },
    { chain_id: 10, full_match: 1, partial_match: 2 },
  ]);
  assert.deepEqual(rows, [{ chain_id: 10, full: 1, partial: 2 }]);
});

test("mapCountRows rejects non-numeric values", () => {
  assert.throws(() =>
    mapCountRows([{ chain_id: 1, full_match: "abc", partial_match: 0 }])
  );
});

test("assertNotEmpty throws on zero rows", () => {
  assert.throws(() => assertNotEmpty([]), /zero rows/);
});

test("assertNotEmpty throws on zero total", () => {
  assert.throws(
    () =>
      assertNotEmpty([
        { chain_id: 1, full: 0, partial: 0 },
        { chain_id: 2, full: 0, partial: 0 },
      ]),
    /zero contracts/
  );
});

test("assertNotEmpty passes on a positive total", () => {
  assertNotEmpty([{ chain_id: 1, full: 0, partial: 1 }]);
});

test("assertNoLargeDrop throws when the new total is below 90% of the old", () => {
  assert.throws(() => assertNoLargeDrop(899, 1000), /below 90%/);
});

test("assertNoLargeDrop passes at 90% and above", () => {
  assertNoLargeDrop(900, 1000);
  assertNoLargeDrop(1500, 1000);
});

test("assertNoLargeDrop passes without a previous total", () => {
  assertNoLargeDrop(1, undefined);
});

test("readPreviousTotal sums the old stats file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "stats-gen-"));
  const statsPath = join(dir, "stats.json");
  await writeFile(
    statsPath,
    JSON.stringify({
      1: { full_match: 100, partial_match: 50 },
      10: { full_match: 20, partial_match: 30 },
    })
  );
  assert.equal(await readPreviousTotal(statsPath), 200);
});

test("readPreviousTotal returns undefined for a missing file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "stats-gen-"));
  assert.equal(await readPreviousTotal(join(dir, "stats.json")), undefined);
});

test("readPreviousTotal returns undefined for an invalid file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "stats-gen-"));
  const statsPath = join(dir, "stats.json");
  await writeFile(statsPath, "{ not json");
  assert.equal(await readPreviousTotal(statsPath), undefined);
});

test("sumContracts adds full and partial counts", () => {
  assert.equal(
    sumContracts([
      { chain_id: 1, full: 1, partial: 2 },
      { chain_id: 2, full: 3, partial: 4 },
    ]),
    10
  );
});

test("buildCountQuery uses the mirror table", () => {
  const query = buildCountQuery("my-project", "sourcify_staging");
  assert.match(query, /`my-project\.sourcify_staging\.public_sourcify_matches`/);
  assert.match(query, /GROUP BY chain_id/);
});

test("buildCountQuery rejects invalid names", () => {
  assert.throws(() => buildCountQuery("bad`project", "sourcify"));
  assert.throws(() => buildCountQuery("project", "bad.dataset"));
});

test("readBigQueryConfig applies defaults", () => {
  const config = readBigQueryConfig({ BIGQUERY_DATASET: "sourcify" });
  assert.deepEqual(config, {
    projectId: undefined,
    dataset: "sourcify",
    location: "europe-west1",
    maximumBytesBilled: "10000000000",
  });
});

test("readBigQueryConfig rejects invalid values", () => {
  assert.throws(() => readBigQueryConfig({}), /BIGQUERY_DATASET is missing/);
  assert.throws(() => readBigQueryConfig({ BIGQUERY_DATASET: "a.b" }));
  assert.throws(() =>
    readBigQueryConfig({ BIGQUERY_DATASET: "a", BIGQUERY_PROJECT_ID: "p.q" })
  );
  assert.throws(() =>
    readBigQueryConfig({ BIGQUERY_DATASET: "a", BIGQUERY_MAX_BYTES_BILLED: "1e9" })
  );
});
