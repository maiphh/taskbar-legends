export const ROLE_ICON: Readonly<Record<string, 'tank' | 'dps' | 'support'>> = {
  tank: 'tank', dps: 'dps', support: 'support', warrior: 'tank', ranger: 'dps', mage: 'support',
};
export function roleIconName(role: string): 'tank' | 'dps' | 'support' { return ROLE_ICON[role.toLowerCase()] ?? 'support'; }
