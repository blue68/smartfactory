/**
 * [artifact:接口联调代码] — Taro.request 封装
 * 功能：
 *   - 统一 baseURL 注入
 *   - Authorization Token 注入（wx.getStorageSync 读取）
 *   - 统一响应结构解包：{ code, data, message }
 *   - 401 跳转登录页
 *   - 4003 库存锁冲突自动重试（最多1次，延迟 800ms）
 *   - 超时处理（默认 15s，AI 接口 60s）
 *   - 网络错误统一提示
 */

import Taro from '@tarojs/taro'

// ─────────────────────────────────────────────
// 全局配置
// ─────────────────────────────────────────────
const BASE_URL = process.env.TARO_APP_API_BASE_URL || 'http://localhost:3000'
const TIMEOUT = 15_000
const TOKEN_KEY = 'sf_access_token'

/** 业务错误码（与 web/src/types/api.ts 保持一致） */
export const ApiCode = {
  SUCCESS: 0,
  UNAUTHORIZED: 1002,
  INVENTORY_LOCK_FAILED: 4003,
} as const

// ─────────────────────────────────────────────
// 统一响应结构
// ─────────────────────────────────────────────
export interface ApiResponse<T = unknown> {
  code: number
  data: T
  message: string
}

export class ApiError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// ─────────────────────────────────────────────
// Token 工具
// ─────────────────────────────────────────────
function getToken(): string {
  return Taro.getStorageSync<string>(TOKEN_KEY) ?? ''
}

export function saveToken(token: string): void {
  Taro.setStorageSync(TOKEN_KEY, token)
}

export function clearToken(): void {
  Taro.removeStorageSync(TOKEN_KEY)
}

// ─────────────────────────────────────────────
// 核心请求函数
// ─────────────────────────────────────────────
interface RequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  data?: unknown
  timeout?: number
}

async function rawRequest<T>(opts: RequestOptions): Promise<T> {
  const token = getToken()

  const response = await Taro.request<ApiResponse<T>>({
    url: `${BASE_URL}${opts.url}`,
    method: opts.method ?? 'GET',
    data: opts.data,
    timeout: opts.timeout ?? TIMEOUT,
    header: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })

  const { statusCode, data: body } = response

  // HTTP 层错误
  if (statusCode === 401) {
    clearToken()
    Taro.showToast({ title: '登录已过期，请重新登录', icon: 'none', duration: 2000 })
    // 延迟跳转，等 Toast 展示
    setTimeout(() => {
      Taro.reLaunch({ url: '/pages/login/index' })
    }, 1500)
    throw new ApiError(ApiCode.UNAUTHORIZED, '登录已过期，请重新登录')
  }

  if (statusCode < 200 || statusCode >= 300) {
    const msg = (body as ApiResponse)?.message ?? `请求失败 (${statusCode})`
    throw new ApiError(statusCode, msg)
  }

  // 业务层错误
  if (!body || body.code !== ApiCode.SUCCESS) {
    throw new ApiError(body?.code ?? -1, body?.message ?? '服务异常，请稍后重试', body?.data)
  }

  return body.data
}

// ─────────────────────────────────────────────
// 4003 锁冲突重试装饰器（最多重试1次，延迟 800ms）
// ─────────────────────────────────────────────
const LOCK_RETRY_DELAY = 800

async function withLockRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ApiError && err.code === ApiCode.INVENTORY_LOCK_FAILED) {
      await delay(LOCK_RETRY_DELAY)
      return fn()
    }
    throw err
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─────────────────────────────────────────────
// 公开 API
// ─────────────────────────────────────────────
async function get<T>(url: string, params?: Record<string, unknown>, timeout?: number): Promise<T> {
  // 将 params 序列化拼接到 url（Taro GET 通过 data 传参时会自动拼 querystring）
  return rawRequest<T>({ url, method: 'GET', data: params, timeout })
}

async function post<T>(url: string, body?: unknown, timeout?: number): Promise<T> {
  return rawRequest<T>({ url, method: 'POST', data: body, timeout })
}

async function put<T>(url: string, body?: unknown): Promise<T> {
  return rawRequest<T>({ url, method: 'PUT', data: body })
}

async function patch<T>(url: string, body?: unknown): Promise<T> {
  return rawRequest<T>({ url, method: 'PATCH', data: body })
}

/** 库存出入库专用：自动处理 4003 锁冲突重试 */
async function postWithLockRetry<T>(url: string, body?: unknown): Promise<T> {
  return withLockRetry(() => post<T>(url, body))
}

/** 文件上传（图片 / 附件） */
async function upload(localPath: string, name = 'file'): Promise<{ url: string }> {
  const token = getToken()
  const response = await Taro.uploadFile({
    url: `${BASE_URL}/api/upload`,
    filePath: localPath,
    name,
    header: token ? { Authorization: `Bearer ${token}` } : {},
  })

  let parsed: ApiResponse<{ url: string }>
  try {
    parsed = JSON.parse(response.data) as ApiResponse<{ url: string }>
  } catch {
    throw new ApiError(-1, '上传响应解析失败')
  }

  if (parsed.code !== ApiCode.SUCCESS) {
    throw new ApiError(parsed.code, parsed.message ?? '上传失败')
  }

  return parsed.data
}

export const request = { get, post, put, patch, postWithLockRetry, upload }
export default request
