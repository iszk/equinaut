#!/usr/bin/env node
import { runIngestionCli } from "../src/server/ingestion/ingest-cli.js";

process.exitCode = await runIngestionCli(process.argv.slice(2));
