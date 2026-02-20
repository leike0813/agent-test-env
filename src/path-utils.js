import path from "node:path";

/**
 * @param {string} candidate
 * @param {string} root
 */
export function isPathInsideRoot(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
