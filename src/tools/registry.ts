import { fileReadTool } from './file-read.js';
import { fileListTool } from './file-list.js';
import { gitStatusTool } from './git-status.js';
import { gitDiffTool } from './git-diff.js';
import { fileWriteTool } from './file-write.js';
import { filePatchTool } from './file-patch.js';
import { shellRunTool } from './shell-run.js';
import { conduitAboutTool } from './conduit-about.js';
import { conduitHelpTool } from './conduit-help.js';
import type { ToolDefinition } from './types.js';

const TOOLS = [
  fileReadTool,
  fileListTool,
  gitStatusTool,
  gitDiffTool,
  conduitAboutTool,
  conduitHelpTool,
  fileWriteTool,
  filePatchTool,
  shellRunTool
] satisfies ToolDefinition[];

export function getTool(name: string): ToolDefinition | null {
  return TOOLS.find((tool) => tool.name === name) ?? null;
}

export function listTools(): ToolDefinition[] {
  return [...TOOLS];
}
