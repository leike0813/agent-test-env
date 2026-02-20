import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

function tomlEscapeQuotedKey(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeCodexRunTrustEntries(source, tableHeader, legacyMatcher) {
  const lines = source.split(/\r?\n/);
  const kept = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (legacyMatcher.test(line)) {
      continue;
    }

    if (line.trim() === tableHeader) {
      index += 1;
      while (index < lines.length) {
        const nextLine = lines[index];
        const trimmed = nextLine.trim();
        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
          index -= 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    kept.push(line);
  }

  return kept.join("\n");
}

/**
 * @param {{ codexHome: string; runDirectory: string }} options
 */
export async function registerCodexRunTrust(options) {
  const configPath = path.join(options.codexHome, "config.toml");
  await mkdir(path.dirname(configPath), { recursive: true });

  let source = "";
  try {
    source = await readFile(configPath, "utf8");
  } catch (error) {
    if (!(error instanceof Error) || !String(error.message).includes("ENOENT")) {
      throw error;
    }
  }

  const escapedRunDirectory = tomlEscapeQuotedKey(options.runDirectory);
  const tableHeader = `[projects."${escapedRunDirectory}"]`;
  const trustAssignment = 'trust_level = "trusted"';
  const legacyKeyPrefix = `projects."${escapedRunDirectory}".trust_level`;
  const legacyMatcher = new RegExp(`^\\s*${escapeRegExp(legacyKeyPrefix)}\\s*=\\s*".*"\\s*$`);

  const cleaned = removeCodexRunTrustEntries(source, tableHeader, legacyMatcher).replace(/\s+$/u, "");
  const injectedBlock = `${tableHeader}\n${trustAssignment}`;
  const updatedSource = cleaned.length > 0 ? `${cleaned}\n\n${injectedBlock}\n` : `${injectedBlock}\n`;

  await writeFile(configPath, updatedSource, "utf8");
  return configPath;
}

/**
 * @param {{ trustedFoldersPath: string; runDirectory: string }} options
 */
export async function registerGeminiRunTrust(options) {
  const trustedFoldersPath = options.trustedFoldersPath;
  await mkdir(path.dirname(trustedFoldersPath), { recursive: true });

  /** @type {Record<string, string>} */
  let trustedFolders = {};
  try {
    const raw = await readFile(trustedFoldersPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      trustedFolders = /** @type {Record<string, string>} */ (parsed);
    }
  } catch (error) {
    if (!(error instanceof Error) || !String(error.message).includes("ENOENT")) {
      throw error;
    }
  }

  trustedFolders[options.runDirectory] = "TRUST_FOLDER";
  await writeFile(trustedFoldersPath, `${JSON.stringify(trustedFolders, null, 2)}\n`, "utf8");
  return trustedFoldersPath;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} context
 */
function requireHome(env, context) {
  if (env.HOME) {
    return env.HOME;
  }
  throw new Error(`HOME is required for ${context}`);
}

/**
 * @param {{
 *   agentName: string;
 *   env: NodeJS.ProcessEnv;
 *   runDirectory: string;
 }} options
 */
export async function registerRunDirectoryTrust(options) {
  /** @type {{ codexConfigPath?: string; geminiTrustedFoldersPath?: string }} */
  const applied = {};

  if (options.agentName === "codex") {
    const codexHome = options.env.CODEX_HOME ?? path.join(requireHome(options.env, "codex trust registration"), ".codex");
    applied.codexConfigPath = await registerCodexRunTrust({
      codexHome,
      runDirectory: options.runDirectory,
    });
  }

  if (options.agentName === "gemini") {
    const geminiTrustedFoldersPath =
      options.env.GEMINI_CLI_TRUSTED_FOLDERS_PATH ??
      (options.env.GEMINI_CLI_HOME
        ? path.join(options.env.GEMINI_CLI_HOME, ".gemini", "trustedFolders.json")
        : path.join(requireHome(options.env, "gemini trust registration"), ".gemini", "trustedFolders.json"));
    applied.geminiTrustedFoldersPath = await registerGeminiRunTrust({
      trustedFoldersPath: geminiTrustedFoldersPath,
      runDirectory: options.runDirectory,
    });
  }

  return applied;
}
