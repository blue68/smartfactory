import { ResponseCode, ResponseCodeValue } from './ApiResponse';

/**
 * 统一业务错误类
 * 所有已知业务错误应抛出此类，由 errorHandler 中间件统一处理
 */
export class AppError extends Error {
  public readonly code: ResponseCodeValue;
  public readonly statusCode: number;
  public readonly data: unknown;

  constructor(
    message: string,
    code: ResponseCodeValue = ResponseCode.INTERNAL_ERROR,
    statusCode = 400,
    data: unknown = null,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.data = data;
    // 修复 TypeScript 继承 Error 的原型链问题
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static notFound(message = '资源不存在', code: ResponseCodeValue = ResponseCode.NOT_FOUND): AppError {
    return new AppError(message, code, 404);
  }

  static unauthorized(message = '请先登录'): AppError {
    return new AppError(message, ResponseCode.UNAUTHORIZED, 401);
  }

  static forbidden(message = '权限不足'): AppError {
    return new AppError(message, ResponseCode.FORBIDDEN, 403);
  }

  static conflict(message: string, code: ResponseCodeValue = ResponseCode.CONFLICT): AppError {
    return new AppError(message, code, 409);
  }

  static badRequest(message: string, code: ResponseCodeValue = ResponseCode.INVALID_PARAMS): AppError {
    return new AppError(message, code, 400);
  }
}
