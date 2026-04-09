import { UserRole } from '@/types/enums';

const TENANT_SUPER_ROLES = new Set<string>([UserRole.ADMIN, UserRole.TENANT_ADMIN]);

export function hasTenantSuperRole(
  roles: string[] | null | undefined,
  scopeLevel?: string | null,
): boolean {
  if (scopeLevel === 'platform') {
    return false;
  }
  return (roles ?? []).some((role) => TENANT_SUPER_ROLES.has(role));
}

export function matchesRoleAccess(
  roles: string[] | null | undefined,
  requiredRoles: string[],
  scopeLevel?: string | null,
): boolean {
  const normalizedRoles = roles ?? [];
  if (normalizedRoles.length === 0) {
    return false;
  }

  if (requiredRoles.includes(UserRole.PLATFORM_SUPER_ADMIN)) {
    return normalizedRoles.includes(UserRole.PLATFORM_SUPER_ADMIN);
  }

  if (hasTenantSuperRole(normalizedRoles, scopeLevel)) {
    return true;
  }

  return requiredRoles.some((role) => normalizedRoles.includes(role));
}
