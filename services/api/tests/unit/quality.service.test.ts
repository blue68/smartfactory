jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: jest.fn(),
  },
}));

import { AppDataSource } from '../../src/config/database';
import { QualityService } from '../../src/modules/quality/quality.service';

const mockQuery = AppDataSource.query as jest.Mock;

describe('QualityService JSON compatibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getIssueDetail 在 JSON 列被驱动直接反序列化为数组时仍可正常返回', async () => {
    mockQuery.mockResolvedValueOnce([{
      id: 7,
      inspection_id: 22,
      inspection_no: 'QC-20260330-001',
      inspection_date: '2026-03-30',
      production_order_id: 35,
      work_order_no: 'WO-35',
      sku_name: '半成品 A',
      component_name: '边缘',
      issue_types: ['appearance', 'dimension'],
      severity: 'normal',
      description: '有毛边',
      images: ['https://example.com/a.png'],
      created_at: new Date('2026-03-30T12:00:00.000Z'),
    }]);

    const svc = new QualityService({ tenantId: 1, userId: 99 });
    const detail = await svc.getIssueDetail(7);

    expect(detail.inspectionId).toBe(22);
    expect(detail.issueTypes).toEqual(['appearance', 'dimension']);
    expect(detail.images).toEqual(['https://example.com/a.png']);
  });

  it('listIssues 在 issue_types 为 JSON 字符串时仍会解析为数组', async () => {
    mockQuery
      .mockResolvedValueOnce([{
        id: 8,
        inspection_id: 23,
        inspection_no: 'QC-20260330-002',
        component_name: '封边',
        issue_types: '["function"]',
        severity: 'severe',
        description: '封边松脱',
        created_at: new Date('2026-03-30T13:00:00.000Z'),
      }])
      .mockResolvedValueOnce([{ total: 1 }]);

    const svc = new QualityService({ tenantId: 1, userId: 99 });
    const result = await svc.listIssues({
      page: 1,
      pageSize: 20,
      severity: 'severe',
      issueType: 'function',
    });

    expect(result.total).toBe(1);
    expect(result.list).toHaveLength(1);
    expect(result.list[0].issueTypes).toEqual(['function']);
    expect(result.list[0].componentName).toBe('封边');
  });

  it('getIssueDetail 在 issue_types 为非 JSON 普通字符串时退化为单元素数组', async () => {
    mockQuery.mockResolvedValueOnce([{
      id: 9,
      inspection_id: 24,
      inspection_no: 'QC-20260330-003',
      inspection_date: '2026-03-30',
      production_order_id: 36,
      work_order_no: 'WO-36',
      sku_name: '半成品 B',
      component_name: '外观',
      issue_types: 'appearance',
      severity: 'minor',
      description: null,
      images: null,
      created_at: new Date('2026-03-30T14:00:00.000Z'),
    }]);

    const svc = new QualityService({ tenantId: 1, userId: 99 });
    const detail = await svc.getIssueDetail(9);

    expect(detail.issueTypes).toEqual(['appearance']);
    expect(detail.images).toBeNull();
  });
});
