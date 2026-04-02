jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: jest.fn(),
  },
}));

import { AppDataSource } from '../../src/config/database';
import { WageService } from '../../src/modules/report/wage.service';

const mockQuery = AppDataSource.query as jest.Mock;

describe('WageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getWageReport 使用 work_reports 的真实字段口径', async () => {
    mockQuery
      .mockResolvedValueOnce([{ cnt: 1 }])
      .mockResolvedValueOnce([{ cnt: 1 }])
      .mockResolvedValueOnce([{
        userId: 9,
        userName: '张三',
        workerGrade: 'skilled',
        stepName: '封边',
        qty: 12,
        unitPrice: '8.00',
        subtotal: '96.00',
        reportDate: '2026-03-29',
      }]);

    const svc = new WageService({ tenantId: 1, userId: 9 });
    const [rows, total] = await svc.getWageReport({
      page: 1,
      pageSize: 20,
      userId: 9,
      dateFrom: '2026-03-01',
    });

    expect(total).toBe(1);
    expect(rows).toHaveLength(1);

    const countSql = mockQuery.mock.calls[1][0] as string;
    const listSql = mockQuery.mock.calls[2][0] as string;

    expect(countSql).toContain('wr.process_step_id');
    expect(countSql).toContain('wr.worker_id');
    expect(countSql).toContain('wr.work_date');
    expect(countSql).toContain("wr.status IN ('confirmed', 'settled')");
    expect(listSql).toContain('wr.qty_completed');
    expect(listSql).toContain('wr.unit_wage');
    expect(listSql).toContain('wr.wage_amount');
  });

  it('getMyWages 强制锁定为当前用户', async () => {
    mockQuery
      .mockResolvedValueOnce([{ cnt: 1 }])
      .mockResolvedValueOnce([{ cnt: 0 }]);

    const svc = new WageService({ tenantId: 1, userId: 33 });
    await svc.getMyWages({ page: 1, pageSize: 10 });

    const params = mockQuery.mock.calls[1][1] as unknown[];
    expect(params).toEqual([1, 33]);
  });

  it('在旧版 work_reports 字段名下仍能查询工资报表', async () => {
    mockQuery
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce([{ cnt: 1 }])
      .mockResolvedValueOnce([{
        userId: 8,
        userName: '李四',
        workerGrade: 'apprentice',
        stepName: '工序 1',
        qty: 5,
        unitPrice: '6.00',
        subtotal: '30.00',
        reportDate: '2026-03-29',
      }]);

    const svc = new WageService({ tenantId: 1, userId: 8 });
    const [rows, total] = await svc.getWageReport({
      page: 1,
      pageSize: 20,
      userId: 8,
    });

    expect(total).toBe(1);
    expect(rows).toHaveLength(1);

    const countSql = mockQuery.mock.calls[1][0] as string;
    const listSql = mockQuery.mock.calls[2][0] as string;
    expect(countSql).toContain('wr.step_id');
    expect(countSql).toContain('wr.user_id');
    expect(listSql).toContain('wr.qty');
    expect(listSql).toContain('DATE_FORMAT(wr.report_date');
  });

  it('getTaskWageReport 查询任务维度报工与工资明细', async () => {
    mockQuery
      .mockResolvedValueOnce([{ cnt: 1 }])
      .mockResolvedValueOnce([{ cnt: 5 }])
      .mockResolvedValueOnce([{ cnt: 1 }])
      .mockResolvedValueOnce([{
        reportId: 101,
        reportNo: 'WR20260330001',
        reportDate: '2026-03-30',
        productionOrderId: 9,
        orderNo: 'WO202603300001',
        taskId: 68,
        taskNo: 'TASK-068',
        taskStatus: 'completed',
        userId: 9,
        userName: '张三',
        workerGrade: 'skilled',
        processStepId: 12,
        stepName: '封边',
        qtyCompleted: '12.0000',
        qtyQualified: '11.0000',
        qtyDefective: '1.0000',
        workHours: '2.50',
        unitPrice: '8.0000',
        subtotal: '96.00',
      }]);

    const svc = new WageService({ tenantId: 1, userId: 9 });
    const [rows, total] = await svc.getTaskWageReport({
      page: 1,
      pageSize: 20,
      userId: 9,
      productionOrderId: 9,
      taskId: 68,
    });

    expect(total).toBe(1);
    expect(rows).toHaveLength(1);

    const countSql = mockQuery.mock.calls[2][0] as string;
    const listSql = mockQuery.mock.calls[3][0] as string;
    const countParams = mockQuery.mock.calls[2][1] as unknown[];
    const listParams = mockQuery.mock.calls[3][1] as unknown[];

    expect(countSql).toContain('LEFT JOIN production_tasks pt');
    expect(countSql).toContain('LEFT JOIN production_orders po');
    expect(countSql).toContain('wr.production_order_id = ?');
    expect(countSql).toContain('wr.task_id = ?');
    expect(listSql).toContain('wr.work_hours');
    expect(listSql).toContain('wr.qty_qualified');
    expect(listSql).toContain('pt.task_no');
    expect(countParams).toEqual([1, 9, 9, 68]);
    expect(listParams).toEqual([1, 9, 9, 68, 20, 0]);
  });

  it('getTaskWageReport 在旧版 work_reports 缺少任务字段时返回空结果', async () => {
    mockQuery
      .mockResolvedValueOnce([{ cnt: 1 }])
      .mockResolvedValueOnce([{ cnt: 0 }]);

    const svc = new WageService({ tenantId: 1, userId: 9 });
    const [rows, total] = await svc.getTaskWageReport({
      page: 1,
      pageSize: 20,
    });

    expect(total).toBe(0);
    expect(rows).toEqual([]);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('getTaskWageReport applies date and worker grade filters with expected parameter order', async () => {
    mockQuery
      .mockResolvedValueOnce([{ cnt: 1 }])
      .mockResolvedValueOnce([{ cnt: 5 }])
      .mockResolvedValueOnce([{ cnt: 0 }]);

    const svc = new WageService({ tenantId: 1, userId: 9 });
    const [rows, total] = await svc.getTaskWageReport({
      page: 1,
      pageSize: 20,
      dateFrom: '2026-03-01',
      dateTo: '2026-03-31',
      userId: 9,
      workerGrade: 'skilled',
      productionOrderId: 99,
      taskId: 68,
    });

    expect(total).toBe(0);
    expect(rows).toEqual([]);

    const countSql = mockQuery.mock.calls[2][0] as string;
    const countParams = mockQuery.mock.calls[2][1] as unknown[];
    expect(countSql).toContain('wr.work_date >= ?');
    expect(countSql).toContain('wr.work_date <= ?');
    expect(countSql).toContain('wr.worker_id = ?');
    expect(countSql).toContain('u.skill_level = ?');
    expect(countSql).toContain('wr.production_order_id = ?');
    expect(countSql).toContain('wr.task_id = ?');
    expect(countParams).toEqual([
      1,
      '2026-03-01',
      '2026-03-31',
      9,
      'skilled',
      99,
      68,
    ]);
  });

  it('getTaskWageReport keeps legacy date/worker/step schema compatibility when task fields exist', async () => {
    mockQuery
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce([{ cnt: 5 }])
      .mockResolvedValueOnce([{ cnt: 1 }])
      .mockResolvedValueOnce([{
        reportId: 202,
        reportNo: 'WR20260331002',
        reportDate: '2026-03-31',
        productionOrderId: 9,
        orderNo: 'WO202603300001',
        taskId: 68,
        taskNo: 'TASK-068',
        taskStatus: 'completed',
        userId: 8,
        userName: '李四',
        workerGrade: 'apprentice',
        processStepId: 18,
        stepName: '工序 1',
        qtyCompleted: '6.0000',
        qtyQualified: '6.0000',
        qtyDefective: '0.0000',
        workHours: '1.50',
        unitPrice: '6.0000',
        subtotal: '36.00',
      }]);

    const svc = new WageService({ tenantId: 1, userId: 8 });
    const [rows, total] = await svc.getTaskWageReport({
      page: 1,
      pageSize: 20,
      dateFrom: '2026-03-01',
      dateTo: '2026-03-31',
      userId: 8,
      workerGrade: 'apprentice',
      productionOrderId: 9,
      taskId: 68,
    });

    expect(total).toBe(1);
    expect(rows).toHaveLength(1);

    const countSql = mockQuery.mock.calls[2][0] as string;
    const listSql = mockQuery.mock.calls[3][0] as string;
    const countParams = mockQuery.mock.calls[2][1] as unknown[];
    const listParams = mockQuery.mock.calls[3][1] as unknown[];

    expect(countSql).toContain('wr.report_date >= ?');
    expect(countSql).toContain('wr.report_date <= ?');
    expect(countSql).toContain('wr.user_id = ?');
    expect(countSql).toContain('ps.id = wr.step_id');
    expect(listSql).toContain("DATE_FORMAT(wr.report_date, '%Y-%m-%d')");
    expect(listSql).toContain('u.id = wr.user_id');
    expect(listSql).toContain('ps.id = wr.step_id');
    expect(countParams).toEqual([
      1,
      '2026-03-01',
      '2026-03-31',
      8,
      'apprentice',
      9,
      68,
    ]);
    expect(listParams).toEqual([
      1,
      '2026-03-01',
      '2026-03-31',
      8,
      'apprentice',
      9,
      68,
      20,
      0,
    ]);
  });
});
