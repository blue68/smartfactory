/**
 * [artifact:接口联调代码] — Axios 封装
 * 功能：JWT 拦截器、401 自动刷新、错误统一处理、4003 锁冲突重试、loading 状态
 */

import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { config } from '@/config';
import { ApiCode, ApiError, type ApiResponse } from '@/types/api';

// ─────────────────────────────────────────────
// Token 工具（与 authStore 保持同步，避免循环依赖）
// SEC H-004: Access Token 存 sessionStorage，兼顾安全与页面刷新体验
// sessionStorage 仅在当前标签页有效，关闭标签页自动清除
// Refresh Token 已改为 HttpOnly Cookie，由浏览器自动携带
// ─────────────────────────────────────────────
const TOKEN_KEY = '__sf_at';

export function getAccessToken(): string | null {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function saveAccessToken(token: string): void {
  try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
}

export function clearTokens(): void {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  localStorage.removeItem(config.userKey);
}

// ─────────────────────────────────────────────
// 全局 loading 计数器（供 appStore 订阅）
// ─────────────────────────────────────────────
type LoadingListener = (loading: boolean) => void;
const loadingListeners = new Set<LoadingListener>();
let activeRequests = 0;

export function onGlobalLoading(fn: LoadingListener): () => void {
  loadingListeners.add(fn);
  return () => loadingListeners.delete(fn);
}

function setLoading(delta: 1 | -1): void {
  activeRequests = Math.max(0, activeRequests + delta);
  const loading = activeRequests > 0;
  loadingListeners.forEach((fn) => fn(loading));
}

// ─────────────────────────────────────────────
// snake_case → camelCase 转换（后端返回 snake_case，前端使用 camelCase）
// ─────────────────────────────────────────────
function toCamelCase(str: string): string {
  return str.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function camelizeKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(camelizeKeys);
  if (obj !== null && typeof obj === 'object' && !(obj instanceof Date) && !(obj instanceof Blob)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[toCamelCase(key)] = camelizeKeys(value);
    }
    return result;
  }
  return obj;
}

// ─────────────────────────────────────────────
// Axios 实例
// ─────────────────────────────────────────────
const instance: AxiosInstance = axios.create({
  baseURL: config.apiBaseUrl,
  timeout: config.requestTimeout,
  // withCredentials: true 确保跨域请求自动携带 HttpOnly Cookie（含 Refresh Token）
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ─────────────────────────────────────────────
// 请求拦截器 — 注入 Authorization
// ─────────────────────────────────────────────
instance.interceptors.request.use(
  (req: InternalAxiosRequestConfig) => {
    const token = getAccessToken();
    if (token) {
      req.headers.Authorization = `Bearer ${token}`;
    }
    setLoading(1);
    return req;
  },
  (err) => {
    setLoading(-1);
    return Promise.reject(err);
  },
);

// ─────────────────────────────────────────────
// Token 刷新队列（防止并发 401 时多次刷新）
// ─────────────────────────────────────────────
let isRefreshing = false;
let refreshQueue: Array<(token: string | null) => void> = [];

function processQueue(token: string | null): void {
  refreshQueue.forEach((resolve) => resolve(token));
  refreshQueue = [];
}

async function refreshAccessToken(): Promise<string | null> {
  try {
    // Refresh Token 由浏览器通过 HttpOnly Cookie 自动携带，无需手动传入 body
    const res = await axios.post<ApiResponse<{ accessToken: string }>>(
      `${config.apiBaseUrl}/api/auth/refresh`,
      undefined,
      { timeout: 10_000, withCredentials: true },
    );
    if (res.data.code === ApiCode.SUCCESS) {
      const newToken = res.data.data.accessToken;
      saveAccessToken(newToken);
      return newToken;
    }
    return null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// 响应拦截器 — 统一解包 + 401 刷新 + 错误转换
// ─────────────────────────────────────────────
instance.interceptors.response.use(
  (res: AxiosResponse<ApiResponse>) => {
    setLoading(-1);

    // Blob 响应（如文件下载）跳过业务解包
    if (res.data instanceof Blob) {
      return res;
    }

    // snake_case → camelCase 转换
    res.data = camelizeKeys(res.data) as ApiResponse;
    const body = res.data;

    // 业务错误：code !== 0
    if (body.code !== ApiCode.SUCCESS) {
      return Promise.reject(new ApiError(body.code, body.message, body.data));
    }

    return res;
  },
  async (err) => {
    setLoading(-1);

    const originalRequest = err.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // 401 — 尝试刷新 Token
    if (err.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        // 等待刷新完成后重试
        return new Promise((resolve, reject) => {
          refreshQueue.push((token) => {
            if (token) {
              originalRequest.headers.Authorization = `Bearer ${token}`;
              resolve(instance(originalRequest));
            } else {
              reject(new ApiError(ApiCode.UNAUTHORIZED, '登录已过期，请重新登录'));
            }
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const newToken = await refreshAccessToken();
      isRefreshing = false;
      processQueue(newToken);

      if (newToken) {
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return instance(originalRequest);
      } else {
        // 刷新失败 — 清除登录态，跳转登录页
        clearTokens();
        window.location.href = '/login';
        return Promise.reject(new ApiError(ApiCode.UNAUTHORIZED, '登录已过期，请重新登录'));
      }
    }

    // 网络错误或服务端未返回 JSON
    if (!err.response) {
      return Promise.reject(new ApiError(-1, '网络连接异常，请检查网络后重试'));
    }

    // 其他 HTTP 错误（403、404、500 等）
    const body: ApiResponse | undefined = err.response.data;
    const code = body?.code ?? err.response.status;
    const message = body?.message ?? `请求失败 (${err.response.status})`;
    return Promise.reject(new ApiError(code, message, body?.data));
  },
);

// ─────────────────────────────────────────────
// 4003 锁冲突自动重试装饰器
// ─────────────────────────────────────────────
async function withLockRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError && err.code === ApiCode.INVENTORY_LOCK_FAILED) {
      await new Promise((r) => setTimeout(r, config.lockRetryDelay));
      return fn();
    }
    throw err;
  }
}

// ─────────────────────────────────────────────
// 公开请求方法（自动解包 data 字段）
// ─────────────────────────────────────────────
async function get<T>(url: string, params?: Record<string, unknown>, cfg?: AxiosRequestConfig): Promise<T> {
  const res = await instance.get<ApiResponse<T>>(url, { params, ...cfg });
  return res.data.data;
}

async function post<T>(url: string, body?: unknown, cfg?: AxiosRequestConfig): Promise<T> {
  const res = await instance.post<ApiResponse<T>>(url, body, cfg);
  return res.data.data;
}

async function put<T>(url: string, body?: unknown, cfg?: AxiosRequestConfig): Promise<T> {
  const res = await instance.put<ApiResponse<T>>(url, body, cfg);
  return res.data.data;
}

async function patch<T>(url: string, body?: unknown, cfg?: AxiosRequestConfig): Promise<T> {
  const res = await instance.patch<ApiResponse<T>>(url, body, cfg);
  return res.data.data;
}

async function del<T>(url: string, cfg?: AxiosRequestConfig): Promise<T> {
  const res = await instance.delete<ApiResponse<T>>(url, cfg);
  return res.data.data;
}

/** 带 4003 重试的 post（库存出入库专用） */
async function postWithLockRetry<T>(url: string, body?: unknown): Promise<T> {
  return withLockRetry(() => post<T>(url, body));
}

/** 下载二进制文件（如 Excel 导出），使用统一 axios instance 自动注入 Token */
async function downloadBlob(url: string, params?: Record<string, unknown>): Promise<Blob> {
  const res = await instance.get(url, { params, responseType: 'blob' });
  return res.data as Blob;
}

export const request = { get, post, put, patch, delete: del, postWithLockRetry, downloadBlob, instance };
export default request;
