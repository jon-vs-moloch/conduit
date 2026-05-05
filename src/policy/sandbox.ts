import path from 'node:path';
import { realpath } from 'node:fs/promises';

export async function resolveInsideProject(inputPath: string, projectRoot: string): Promise<string> {
  const realProjectRoot = await realpath(projectRoot);
  const absolutePath = path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(realProjectRoot, inputPath);

  let resolvedPath = absolutePath;
  try {
    resolvedPath = await realpath(absolutePath);
  } catch {
    resolvedPath = path.resolve(absolutePath);
  }

  const relative = path.relative(realProjectRoot, resolvedPath);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return resolvedPath;
  }

  throw new Error(`Path is outside project root: ${inputPath}`);
}
