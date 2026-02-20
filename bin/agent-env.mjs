#!/usr/bin/env node

import { runCli } from "../src/cli.js";

runCli(process.argv.slice(2)).then(
  (code) => {
    process.exit(code);
  },
  (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
