#!/usr/bin/env node
import { runBitbankIngestion } from "../src/server/ingestion/run.js";

const source = process.argv[2];

if (source !== "bitbank") {
  console.error("usage: tsx scripts/ingest.ts bitbank");
  process.exit(1);
}

const result = await runBitbankIngestion();
const output = result.status === "success" ? console.log : console.error;
output(result.message);

if (result.status !== "success") {
  process.exit(1);
}
