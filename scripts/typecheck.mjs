import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const TARGET_DIRECTORIES = ["src", "test", "bin", "scripts"];
const FILE_EXTENSIONS = new Set([".js", ".mjs"]);

async function collectFiles(directory) {
  const absoluteDirectory = path.resolve(ROOT, directory);
  /** @type {string[]} */
  const files = [];

  let entries = [];
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const absolutePath = path.join(absoluteDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path.relative(ROOT, absolutePath))));
      continue;
    }
    if (entry.isFile() && FILE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(absolutePath);
    }
  }

  return files;
}

let hasError = false;
let checked = 0;

for (const directory of TARGET_DIRECTORIES) {
  const files = await collectFiles(directory);
  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], {
      encoding: "utf8",
      stdio: "pipe",
    });
    checked += 1;
    if (result.status !== 0) {
      hasError = true;
      process.stderr.write(result.stdout);
      process.stderr.write(result.stderr);
    }
  }
}

if (hasError) {
  process.exitCode = 1;
} else {
  process.stdout.write(`Syntax/type guard check passed for ${checked} files.\n`);
}
