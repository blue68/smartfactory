import { AppError } from '../../src/shared/AppError';
import { matchesTenantRoleAccess, hasTenantSuperRole } from '../../src/shared/roleAccess';
import { ScheduleSuggestionService } from '../../src/modules/schedule-suggestion/schedule-suggestion.service';
import { DyeLotAuthorizeService } from '../../src/modules/inventory/dyeLotAuthorize.service';

jest.mock('../../src/shared/queue-service', () => ({
  queueService: {
    addJob: jest.fn(),
    getJobStatus: jest.fn(),
  },
}));

describe('tenant admin role access', () => {
  it('treats tenant_admin as tenant-scoped super role', () => {
    expect(hasTenantSuperRole(['tenant_admin'])).toBe(true);
    expect(matchesTenantRoleAccess(['tenant_admin'], ['boss'])).toBe(true);
    expect(matchesTenantRoleAccess(['tenant_admin'], ['supervisor', 'warehouse'])).toBe(true);
  });

  it('does not treat tenant_admin as platform super admin', () => {
    expect(matchesTenantRoleAccess(['tenant_admin'], ['platform_super_admin'])).toBe(false);
    expect(hasTenantSuperRole(['tenant_admin'], 'platform')).toBe(false);
  });

  it('does not classify tenant_admin as purchase-only role in schedule suggestion service', () => {
    const svc = new ScheduleSuggestionService({
      tenantId: 9,
      userId: 18,
      roles: ['tenant_admin', 'purchase'],
      actionCodes: ['schedule:suggestion:purchase:view', 'schedule:suggestion:production:view'],
    } as any);

    expect((svc as any).isPurchaseOnlyRole()).toBe(false);
  });

  it('classifies custom purchase-view role as purchase-only context in schedule suggestion service', () => {
    const svc = new ScheduleSuggestionService({
      tenantId: 9,
      userId: 18,
      roles: ['custom_purchase_viewer'],
      actionCodes: ['schedule:suggestion:purchase:view'],
    } as any);

    expect((svc as any).isPurchaseOnlyRole()).toBe(true);
    expect((svc as any).resolveVisibleItemType()).toBe('purchase');
  });

  it('classifies custom production-view role as production-only context in schedule suggestion service', () => {
    const svc = new ScheduleSuggestionService({
      tenantId: 9,
      userId: 18,
      roles: ['custom_production_viewer'],
      actionCodes: ['schedule:suggestion:production:view'],
    } as any);

    expect((svc as any).isPurchaseOnlyRole()).toBe(false);
    expect((svc as any).resolveVisibleItemType()).toBe('production');
  });

  it('allows tenant_admin to pass dye lot authorization reviewer guard', () => {
    const svc = new DyeLotAuthorizeService({
      tenantId: 9,
      userId: 18,
      roles: ['tenant_admin'],
      actionCodes: ['inventory:maintain'],
    } as any);

    expect(() => (svc as any).assertAuthorizeRole()).not.toThrow();
  });

  it('still blocks plain worker without reviewer permission on dye lot authorization reviewer guard', () => {
    const svc = new DyeLotAuthorizeService({
      tenantId: 9,
      userId: 18,
      roles: ['worker'],
      actionCodes: ['inventory:outbound'],
    } as any);

    expect(() => (svc as any).assertAuthorizeRole()).toThrow(AppError);
  });
});
