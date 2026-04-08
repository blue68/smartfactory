export interface PermissionDataScope {
  scopeType: string;
  scopeValues: Array<string | number>;
}

export type AccessScopeLevel = 'platform' | 'tenant';

export interface PermissionSnapshot {
  version: string;
  scopeLevel: AccessScopeLevel;
  originTenantId: number;
  contextTenantId: number | null;
  menuCodes: string[];
  actionCodes: string[];
  dataScopes: PermissionDataScope[];
  featureFlags: string[];
}

export interface AccessControlContext {
  tenantId: number;
  userId: number;
  roles: string[];
  originTenantId: number;
  contextTenantId: number | null;
  scopeLevel: AccessScopeLevel;
}
