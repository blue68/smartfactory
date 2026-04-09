export const TENANT_SUPER_ROLE_CODES = new Set(['admin', 'tenant_admin']);

export function hasTenantSuperRole(
  roleCodes: string[] | null | undefined,
  scopeLevel: 'platform' | 'tenant' = 'tenant',
): boolean {
  if (scopeLevel !== 'tenant') {
    return false;
  }
  return (roleCodes ?? []).some((roleCode) => TENANT_SUPER_ROLE_CODES.has(roleCode));
}

export function matchesTenantRoleAccess(
  roleCodes: string[] | null | undefined,
  allowedRoles: string[],
  scopeLevel: 'platform' | 'tenant' = 'tenant',
): boolean {
  const normalizedRoleCodes = roleCodes ?? [];
  if (normalizedRoleCodes.length === 0) {
    return false;
  }

  if (allowedRoles.includes('platform_super_admin')) {
    return normalizedRoleCodes.includes('platform_super_admin');
  }

  if (hasTenantSuperRole(normalizedRoleCodes, scopeLevel)) {
    return true;
  }

  return allowedRoles.some((allowedRole) => normalizedRoleCodes.includes(allowedRole));
}

export function matchesDirectRoleAccess(
  roleCodes: string[] | null | undefined,
  allowedRoles: string[],
): boolean {
  const normalizedRoleCodes = roleCodes ?? [];
  if (normalizedRoleCodes.length === 0) {
    return false;
  }
  return allowedRoles.some((allowedRole) => normalizedRoleCodes.includes(allowedRole));
}
