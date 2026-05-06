import { createHash } from 'node:crypto';

const ACTION_FIELDS = new Set([
  'action',
  'call',
  'do',
  'op',
  'tool',
  'read',
  'list',
  'status',
  'diff',
  'write',
  'patch',
  'shell',
  'help',
  'about',
  '.help',
  '.about',
  'path',
  'topic',
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
  'risk',
  'why'
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
  shell_run: 'shell.run',
  help: 'conduit.help',
  '.help': 'conduit.help',
  about: 'conduit.about',
  '.about': 'conduit.about',
  docs: 'conduit.help',
  'conduit.help': 'conduit.help',
  conduit_help: 'conduit.help',
  'conduit.about': 'conduit.about',
  conduit_about: 'conduit.about'
};

export function normalizeCompactRequest(value: unknown): unknown {
  if (!isRecord(value)) return value;

  const requestWithAliases = normalizeRequestAliases(value);
  const normalizedActions = normalizeActions(requestWithAliases);
  if (!normalizedActions) {
    return requestWithAliases;
  }

  const request = { ...requestWithAliases };
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

  if (Array.isArray(value.do)) {
    return value.do.map((action, index) => normalizeAction(action, index));
  }

  if (isCompactAction(value)) {
    return [normalizeAction(value, 0)];
  }

  return null;
}

function normalizeAction(value: unknown, index: number): unknown {
  if (typeof value === 'string') {
    return normalizeAction(parseActionString(value), index);
  }

  if (!isRecord(value)) {
    return value;
  }

  const explicitTool = stringValue(value.tool)
    ?? stringValue(value.action)
    ?? stringValue(value.call)
    ?? stringValue(value.do)
    ?? stringValue(value.op)
    ?? firstPresentAlias(value);
  const tool = explicitTool ? TOOL_ALIASES[explicitTool] ?? explicitTool : undefined;
  if (!tool) {
    return value;
  }

  const args = {
    ...(isRecord(value.args) ? value.args : {}),
    ...argsFromCompactFields(value, tool)
  };
  const reason = stringValue(value.reason) ?? stringValue(value.why);
  const action = {
    id: stringValue(value.id) ?? stableActionId(tool, args, index),
    tool,
    args,
    ...(reason ? { reason } : {}),
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

  if (tool === 'conduit.help') {
    return compactArgs(value, ['topic'], {
      topic: value.help ?? value['.help']
    });
  }

  if (tool === 'conduit.about') {
    return {};
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
  for (const alias of ['read', 'list', 'status', 'diff', 'write', 'patch', 'shell', 'help', 'about', '.help', '.about'] as const) {
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
    || stringValue(value.do) !== undefined
    || Array.isArray(value.do)
    || stringValue(value.op) !== undefined
    || firstPresentAlias(value) !== undefined;
}

function normalizeRequestAliases(value: Record<string, unknown>): Record<string, unknown> {
  const request = { ...value };
  if (request.sessionId === undefined) {
    request.sessionId = stringValue(value.session) ?? stringValue(value.sid);
  }
  if (request.nonce === undefined) {
    request.nonce = stringValue(value.n) ?? stringValue(value.callNonce);
  }
  if (request.schema === undefined && stringValue(value.v) === '1') {
    request.schema = 'conduit.request.v1';
  }
  return request;
}

function parseActionString(value: string): Record<string, unknown> {
  const [rawOp, ...rest] = value.trim().split(/\s+/);
  const op = rawOp ?? '';
  const operand = rest.join(' ');
  if (!operand) {
    return { do: op };
  }
  if (op === 'shell' || op === 'sh' || op === 'run') {
    return { do: op, command: operand };
  }
  if (op === 'help' || op === '.help' || op === 'docs') {
    return operand ? { do: op, topic: operand } : { do: op };
  }
  if (op === 'about' || op === '.about') {
    return { do: op };
  }
  if (op === 'status' || op === 'git.status' || op === 'git_status') {
    return { do: op };
  }
  return { do: op, path: operand };
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
