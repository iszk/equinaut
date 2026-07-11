#!/usr/bin/env node
import { runBitbankIngestion, runBitflyerIngestion, runSaxoIngestion } from "../src/server/ingestion/run.js";

const source = process.argv[2];

if (source !== "bitbank" && source !== "bitflyer" && source !== "saxo") {
  console.error("usage: tsx scripts/ingest.ts <bitbank|bitflyer|saxo>");
  process.exit(1);
}

const result =
  source === "bitbank" ? await runBitbankIngestion() : source === "bitflyer" ? await runBitflyerIngestion() : await runSaxoIngestion();
const output = result.status === "success" ? console.log : console.error;
output(result.message);

if (result.status !== "success") {
  process.exit(1);
}
