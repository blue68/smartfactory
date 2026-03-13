import { Request, Response } from 'express';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { WageService } from './wage.service';
import { success, buildPaginated } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';

const WageFilterSchema = PaginationSchema.extend({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  userId: z.coerce.number().int().positive().optional(),
  workerGrade: z.enum(['skilled', 'apprentice']).optional(),
});

/** 导出筛选参数（与报表相同，无需分页） */
const WageExportQuerySchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  userId: z.coerce.number().int().positive().optional(),
  workerGrade: z.enum(['skilled', 'apprentice']).optional(),
});

export class WageController {
  private svc(req: Request): WageService {
    return new WageService({ tenantId: req.tenantId, userId: req.userId });
  }

  /** GET /api/reports/wages — 管理员查看工资报表 */
  async getWageReport(req: Request, res: Response): Promise<void> {
    const q = WageFilterSchema.parse(req.query);
    const [list, total] = await this.svc(req).getWageReport({
      page: q.page,
      pageSize: q.pageSize,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      userId: q.userId,
      workerGrade: q.workerGrade,
    });
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }

  /** GET /api/reports/wages/export — 导出工资报表 Excel */
  async exportExcel(req: Request, res: Response): Promise<void> {
    const q = WageExportQuerySchema.parse(req.query);
    const list = await this.svc(req).exportWages(q);

    const header = ['工人', '技能等级', '工序', '完成数量', '单价', '小计', '日期'];
    const rows = list.map((r) => [
      r.userName, r.workerGrade, r.stepName, r.qty,
      r.unitPrice, r.subtotal, r.reportDate,
    ]);

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws['!cols'] = [
      { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 10 },
      { wch: 10 }, { wch: 12 }, { wch: 12 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '工资报表');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const filename = encodeURIComponent(`工资报表_${new Date().toISOString().slice(0, 10)}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.setHeader('Content-Length', String(buf.length));
    res.end(buf);
  }

  /** GET /api/my/wages — 当前用户查看自己的工资 */
  async getMyWages(req: Request, res: Response): Promise<void> {
    const q = WageFilterSchema.parse(req.query);
    const [list, total] = await this.svc(req).getMyWages({
      page: q.page,
      pageSize: q.pageSize,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
    });
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }
}

export const wageController = new WageController();
