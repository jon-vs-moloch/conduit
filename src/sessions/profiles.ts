export type PermissionProfileName = 'read-only' | 'edit-with-confirmation' | 'shell-manual';

export interface PermissionProfile {
  name: PermissionProfileName;
  autoAllow: string[];
  requireConfirmation: string[];
  deny: string[];
}

export const PROFILES: Record<PermissionProfileName, PermissionProfile> = {
  'read-only': {
    name: 'read-only',
    autoAllow: ['file.read', 'file.list', 'git.status', 'git.diff'],
    requireConfirmation: [],
    deny: ['file.patch', 'file.write', 'shell.run']
  },
  'edit-with-confirmation': {
    name: 'edit-with-confirmation',
    autoAllow: ['file.read', 'file.list', 'git.status', 'git.diff'],
    requireConfirmation: ['file.patch', 'file.write'],
    deny: ['shell.run']
  },
  'shell-manual': {
    name: 'shell-manual',
    autoAllow: ['file.read', 'file.list', 'git.status', 'git.diff'],
    requireConfirmation: ['file.patch', 'file.write', 'shell.run'],
    deny: []
  }
};

export function isPermissionProfileName(value: string): value is PermissionProfileName {
  return value === 'read-only' || value === 'edit-with-confirmation' || value === 'shell-manual';
}
