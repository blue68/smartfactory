import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

type RequestPart = 'body' | 'query' | 'params';

/**
 * Zod 请求参数校验中间件工厂
 *
 * 用法：
 *   router.post('/skus', validate('body', CreateSkuSchema), controller.create)
 *   router.get('/skus', validate('query', ListSkuQuerySchema), controller.list)
 */
export function validate(part: RequestPart, schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      // 直接抛出 ZodError，由 errorHandler 统一处理
      throw new ZodError(result.error.errors);
    }
    // 将解析后的值（含默认值、类型转换）回写到 req
    req[part] = result.data;
    next();
  };
}

/**
 * 通用分页参数 Schema（供各模块复用）
 */
import { z } from 'zod';

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

export type PaginationQuery = z.infer<typeof PaginationSchema>;
