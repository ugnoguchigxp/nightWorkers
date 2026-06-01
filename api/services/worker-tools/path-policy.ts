import path from 'node:path';

/**
 * Checks if a given path is within the allowed repository workspace.
 * Resolves symlinks and prevents directory traversal attacks.
 */
export function isPathSafe(
  targetPath: string,
  repoRoot: string,
  allowedPaths?: string[],
  deniedPaths?: string[]
): boolean {
  const absoluteRepoRoot = path.resolve(repoRoot);
  let absoluteTargetPath = path.resolve(targetPath);

  // If targetPath is relative, resolve it relative to repoRoot
  if (!path.isAbsolute(targetPath)) {
    absoluteTargetPath = path.resolve(absoluteRepoRoot, targetPath);
  }

  // Check if targetPath is within absoluteRepoRoot
  const relative = path.relative(absoluteRepoRoot, absoluteTargetPath);
  const isInside = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));

  if (!isInside) {
    return false;
  }

  // If there's an allowedPaths list, check if the path matches at least one pattern
  if (allowedPaths && allowedPaths.length > 0) {
    const isAllowed = allowedPaths.some((allowed) => {
      const absAllowed = path.resolve(absoluteRepoRoot, allowed);
      const relToAllowed = path.relative(absAllowed, absoluteTargetPath);
      return (
        relToAllowed === '' || (!relToAllowed.startsWith('..') && !path.isAbsolute(relToAllowed))
      );
    });
    if (!isAllowed) {
      return false;
    }
  }

  // If there's a deniedPaths list, check if the path matches any pattern
  if (deniedPaths && deniedPaths.length > 0) {
    const isDenied = deniedPaths.some((denied) => {
      const absDenied = path.resolve(absoluteRepoRoot, denied);
      const relToDenied = path.relative(absDenied, absoluteTargetPath);
      return relToDenied === '' || (!relToDenied.startsWith('..') && !path.isAbsolute(relToDenied));
    });
    if (isDenied) {
      return false;
    }
  }

  return true;
}

export function getRelativePath(targetPath: string, repoRoot: string): string {
  const absoluteRepoRoot = path.resolve(repoRoot);
  const absoluteTargetPath = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(absoluteRepoRoot, targetPath);
  return path.relative(absoluteRepoRoot, absoluteTargetPath);
}
