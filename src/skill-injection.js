import path from "node:path";
import {
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";

const AGENT_SKILL_ROOTS = {
  codex: path.join(".codex", "skills"),
  gemini: path.join(".gemini", "skills"),
  iflow: path.join(".iflow", "skills"),
  opencode: path.join(".opencode", "skills"),
};
const COMPLETION_SIGNAL_PREFIX = "{\"__SKILL_DONE__\": true}";
const INJECTED_CONTRACT_HEADER = "## Runtime Completion Contract (Injected by agent-env)";

/**
 * @param {string} projectRoot
 */
function resolveSkillsSourceRoot(projectRoot) {
  return path.resolve(projectRoot, "skills");
}

/**
 * @param {string} skillName
 */
function buildCompletionContractAppendix(skillName) {
  return [
    INJECTED_CONTRACT_HEADER,
    "",
    `Skill package: ${skillName}`,
    "You MUST strictly follow the steps defined in this SKILL document.",
    "Do NOT exceed execution boundaries or perform extra tasks outside the documented scope.",
    "When and only when the SKILL-defined task is fully completed, emit completion marker with __SKILL_DONE__ = true and stop immediately.",
    "If the required final output above is NOT a JSON object, output one extra JSON object line exactly as:",
    COMPLETION_SIGNAL_PREFIX,
    "If the required final output above IS a JSON object, include \"__SKILL_DONE__\": true in that final JSON object instead of emitting a separate done object line.",
    "",
    "Rules:",
    "1. The done marker must appear exactly once.",
    "2. Do not wrap it in markdown code fences.",
    "3. Do not output any extra content after the final output containing __SKILL_DONE__.",
  ].join("\n");
}

/**
 * @param {string} runDirectory
 * @param {string} agentName
 */
function resolveAgentSkillsRoot(runDirectory, agentName) {
  const mapped = AGENT_SKILL_ROOTS[/** @type {keyof typeof AGENT_SKILL_ROOTS} */ (agentName)];
  if (!mapped) {
    throw new Error(`Skill injection is unsupported for agent "${agentName}"`);
  }
  return path.join(runDirectory, mapped);
}

/**
 * @param {string} directoryPath
 */
async function directoryExists(directoryPath) {
  try {
    const fileStat = await stat(directoryPath);
    return fileStat.isDirectory();
  } catch (error) {
    if (error instanceof Error && String(error.message).includes("ENOENT")) {
      return false;
    }
    throw error;
  }
}

/**
 * @param {string} skillFilePath
 * @param {string} skillName
 */
async function appendCompletionContract(skillFilePath, skillName) {
  let current;
  try {
    current = await readFile(skillFilePath, "utf8");
  } catch (error) {
    if (error instanceof Error && String(error.message).includes("ENOENT")) {
      throw new Error(`Injected skill "${skillName}" is missing required SKILL.md`);
    }
    throw error;
  }

  if (current.includes(INJECTED_CONTRACT_HEADER)) {
    return false;
  }

  const appendix = buildCompletionContractAppendix(skillName);
  const trimmed = current.replace(/\s+$/u, "");
  await writeFile(skillFilePath, `${trimmed}\n\n${appendix}\n`, "utf8");
  return true;
}

/**
 * @param {{
 *   projectRoot: string;
 *   runDirectory: string;
 *   agentName: string;
 * }} options
 */
export async function injectAllSkillPackages(options) {
  const skillsSourceRoot = resolveSkillsSourceRoot(options.projectRoot);
  const targetRoot = resolveAgentSkillsRoot(options.runDirectory, options.agentName);
  await mkdir(targetRoot, { recursive: true });
  const hasSourceRoot = await directoryExists(skillsSourceRoot);
  if (!hasSourceRoot) {
    return {
      mode: "all",
      sourceRoot: skillsSourceRoot,
      targetRoot,
      skillCount: 0,
      skills: [],
      injectedSkills: [],
      completionSignalPrefix: COMPLETION_SIGNAL_PREFIX,
      appendedCompletionContractCount: 0,
    };
  }
  const entries = await readdir(skillsSourceRoot, { withFileTypes: true });
  const directoryNames = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  /** @type {Array<{
   *   skillName: string;
   *   sourceDirectory: string;
   *   targetDirectory: string;
   *   targetSkillPath: string;
   *   appendedCompletionContract: boolean;
   * }>} */
  const injectedSkills = [];
  let appendedCompletionContractCount = 0;

  for (const skillName of directoryNames) {
    const sourceDirectory = path.join(skillsSourceRoot, skillName);
    const targetDirectory = path.join(targetRoot, skillName);
    await rm(targetDirectory, { recursive: true, force: true });
    await cp(sourceDirectory, targetDirectory, { recursive: true });

    const targetSkillPath = path.join(targetDirectory, "SKILL.md");
    const appendedCompletionContract = await appendCompletionContract(targetSkillPath, skillName);
    if (appendedCompletionContract) {
      appendedCompletionContractCount += 1;
    }
    injectedSkills.push({
      skillName,
      sourceDirectory,
      targetDirectory,
      targetSkillPath,
      appendedCompletionContract,
    });
  }

  return {
    mode: "all",
    sourceRoot: skillsSourceRoot,
    targetRoot,
    skillCount: injectedSkills.length,
    skills: injectedSkills.map((item) => item.skillName),
    injectedSkills,
    completionSignalPrefix: COMPLETION_SIGNAL_PREFIX,
    appendedCompletionContractCount,
  };
}
