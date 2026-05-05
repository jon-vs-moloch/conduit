import { getTool } from '../tools/registry.js';

export function getToolRisk(toolName: string): 'low' | 'medium' | 'high' | 'unknown' {
  return getTool(toolName)?.risk ?? 'unknown';
}
