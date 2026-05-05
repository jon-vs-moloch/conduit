import { createHash } from 'node:crypto';

const ACTION_FIELDS = new Set([
  'action',
  'call',
  'tool',
  'read',
  'list',
  'status',
  'diff',
  'write',
  'patch',
  'shell',
  'path',
  'paths',
  'glob',
  'command',
  'content',
  'mode',
  'maxChars',
  'offset',
  'startLine',
  'endLine',
  'depth',
  'maxItems',
  'args',
  'id',
  'reason',
  'risk'
]);

const TOOL_ALIASES: Record<string, string> = {
  read: 'file.read',
  'file.read': 'file.read',
  file_read: 'file.read',
  list: 'file.list',
  ls: 'file.list',
  'file.list': 'file.list',
  file_list: 'file.list',
  status: 'git.status',
  'git.status': 'git.status',
  git_status: 'git.status',
  diff: 'git.diff',
  'git.diff': 'git.diff',
  git_diff: 'git.diff',
  write: 'file.write',
  'file.write': 'file.write',
  file_write: 'file.write',
  patch: 'file.patch',
  'file.patch': 'file.patch',
  file_patch: 'file.patch',
  shell: 'shell.run',
  sh: 'shell.run',
  run: 'shell.run',
  'shell.run': 'shell.run',
  shell_run: 'shell.run'
};

export function normalizeCompactRequest(value: unknown): unknown {
  if (!isRecord(value)) return value;

  const normalizedActions = normalizeActions(value);
  if (!normalizedActions) {
    return value;
  }

  const request = { ...value };
  for (const field of ACTION_FIELDS) {
    if (field !== 'actions') {
      delete request[field];
    }
  }
  request.actions = normalizedActions;
  return request;
}

function normalizeActions(value: Record<string, unknown>): unknown[] | null {
  if (Array.isArray(value.actions)) {
    return value.actions.map((action, index) => normalizeAction(action, index));
  }

  if (isCompactAction(value)) {
    return [normalizeAction(value, 0)];
  }

  return null;
}

function normalizeAction(value: unknown, index: number): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const explicitTool = stringValue(value.tool)
    ?? stringValue(value.action)
    ?? stringValue(value.call)
    ?? firstPresentAlias(value);
  const tool = explicitTool ? TOOL_ALIASES[explicitTool] ?? explicitTool : undefined;
  if (!tool) {
    return value;
  }

  const args = {
    ...(isRecord(value.args) ? value.args : {}),
    ...argsFromCompactFields(value, tool)
  };
  const action = {
    id: stringValue(value.id) ?? stableActionId(tool, args, index),
    tool,
    args,
    ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
    ...(isRisk(value.risk) ? { risk: value.risk } : {})
  };
  return action;
}

function argsFromCompactFields(value: Record<string, unknown>, tool: string): Record<string, unknown> {
  if (tool === 'file.read') {
    return compactArgs(value, ['path', 'maxChars', 'offset', 'startLine', 'endLine'], {
      path: value.read
    });
  }

  if (tool === 'file.list') {
    return compactArgs(value, ['path', 'depth', 'glob', 'maxItems'], {
      path: value.list
    });
  }

  if (tool === 'git.diff') {
    return compactArgs(value, ['path'], {
      path: value.diff
    });
  }

  if (tool === 'file.write') {
    return compactArgs(value, ['path', 'content', 'mode'], {
      path: value.write
    });
  }

  if (tool === 'file.patch') {
    return compactArgs(value, ['patch'], {
      patch: value.patch
    });
  }

  if (tool === 'shell.run') {
    return compactArgs(value, ['command'], {
      command: value.shell
    });
  }

  return {};
}

function compactArgs(
  value: Record<string, unknown>,
  fields: string[],
  aliases: Record<string, unknown>
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const [key, aliasValue] of Object.entries(aliases)) {
    if (aliasValue !== undefined && aliasValue !== true) {
      args[key] = aliasValue;
    }
  }
  for (const field of fields) {
    if (value[field] !== undefined) {
      args[field] = value[field];
    }
  }
  return args;
}

function firstPresentAlias(value: Record<string, unknown>): string | undefined {
  for (const alias of ['read', 'list', 'status', 'diff', 'write', 'patch', 'shell'] as const) {
    if (value[alias] !== undefined) {
      return alias;
    }
  }
  return undefined;
}

function isCompactAction(value: Record<string, unknown>): boolean {
  return stringValue(value.tool) !== undefined
    || stringValue(value.action) !== undefined
    || stringValue(value.call) !== undefined
    || firstPresentAlias(value) !== undefined;
}

function stableActionId(tool: string, args: Record<string, unknown>, index: number): string {
  const slug = tool.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'action';
  const hash = createHash('sha256')
    .update(JSON.stringify({ tool, args, index }))
    .digest('hex')
    .slice(0, 8);
  return `${slug}_${hash}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRisk(value: unknown): value is 'low' | 'medium' | 'high' {
  return value === 'low' || value === 'medium' || value === 'high';
}
