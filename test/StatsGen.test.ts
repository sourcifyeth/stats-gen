import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCountQuery,
  mapCountRows,
  readBigQueryConfig,
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
