/**
 * [artifact:接口联调代码] — 客户管理 API (R-07)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';
import type { PaginatedData } from '@/types/api';

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

export type CustomerGrade = 'VIP' | 'A' | 'B' | 'C';
export type CustomerStatus = 'active' | 'inactive';

export interface Customer {
  id: number;
  code: string;
  name: string;
  grade: CustomerGrade;
  contact?: string;
  phone?: string;
  email?: string;
  address?: string;
  region?: string;
  creditLimit?: string;
  paymentDays?: number;
  notes?: string;
  status: CustomerStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerContact {
  id: number;
  customerId: number;
  name: string;
  title?: string;
  phone?: string;
  email?: string;
  isPrimary: boolean;
}

export interface CustomerOption {
  id: number;
  name: string;
  code: string;
  grade: CustomerGrade;
  paymentDays?: number;
}

/** 客户关联订单概要 */
export interface CustomerOrderSummary {
  id: number;
  orderNo: string;
  orderDate: string;
  deliveryDate: string;
  isUrgent: boolean;
  status: string;
  totalAmount: string;
}

export interface CustomerListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  grade?: CustomerGrade | '';
  status?: CustomerStatus | '';
}

export interface CreateCustomerPayload {
  code: string;
  name: string;
  grade?: CustomerGrade;
  contact?: string;
  phone?: string;
  email?: string;
  address?: string;
  region?: string;
  creditLimit?: string;
  paymentDays?: number;
  notes?: string;
}

export interface CreateContactPayload {
  name: string;
  title?: string;
  phone?: string;
  email?: string;
  isPrimary?: boolean;
}

// ─────────────────────────────────────────────
// API 函数
// ─────────────────────────────────────────────

const BASE = '/api/customers';

export async function fetchCustomers(query: CustomerListQuery): Promise<PaginatedData<Customer>> {
  return request.get<PaginatedData<Customer>>(BASE, query as Record<string, unknown>);
}

export async function fetchCustomer(id: number): Promise<Customer> {
  return request.get<Customer>(`${BASE}/${id}`);
}

export async function createCustomer(payload: CreateCustomerPayload): Promise<Customer> {
  return request.post<Customer>(BASE, payload);
}

export async function updateCustomer(id: number, payload: Partial<CreateCustomerPayload>): Promise<Customer> {
  return request.put<Customer>(`${BASE}/${id}`, payload);
}

export async function fetchCustomerOptions(): Promise<CustomerOption[]> {
  return request.get<CustomerOption[]>(`${BASE}/options`);
}

export async function fetchCustomerContacts(customerId: number): Promise<CustomerContact[]> {
  return request.get<CustomerContact[]>(`${BASE}/${customerId}/contacts`);
}

export async function createCustomerContact(customerId: number, payload: CreateContactPayload): Promise<CustomerContact> {
  return request.post<CustomerContact>(`${BASE}/${customerId}/contacts`, payload);
}

export async function deleteCustomerContact(customerId: number, contactId: number): Promise<void> {
  return request.delete<void>(`${BASE}/${customerId}/contacts/${contactId}`);
}

/** PATCH /api/customers/:id/status — 启用/禁用客户 */
export async function patchCustomerStatus(id: number, status: CustomerStatus): Promise<{ id: number; status: CustomerStatus }> {
  return request.patch<{ id: number; status: CustomerStatus }>(`${BASE}/${id}/status`, { status });
}

/** PUT /api/customers/:id/contacts/:contactId — 更新联系人 */
export async function updateCustomerContact(
  customerId: number,
  contactId: number,
  payload: Partial<CreateContactPayload>,
): Promise<CustomerContact> {
  return request.put<CustomerContact>(`${BASE}/${customerId}/contacts/${contactId}`, payload);
}

/** GET /api/customers/:id/orders — 客户关联订单概要（最近 5 条） */
export async function fetchCustomerOrders(
  customerId: number,
  params?: { page?: number; pageSize?: number },
): Promise<import('@/types/api').PaginatedData<CustomerOrderSummary>> {
  return request.get(`${BASE}/${customerId}/orders`, { page: 1, pageSize: 5, ...params });
}

/** GET /api/customers/:id — 检查客户是否有进行中订单（通过订单接口） */
export async function checkCustomerActiveOrders(id: number): Promise<{ count: number }> {
  return request.get<{ count: number }>(`${BASE}/${id}/orders/active-count`);
}

// ─────────────────────────────────────────────
// React Query Hooks
// ─────────────────────────────────────────────

export function useCustomerList(query: CustomerListQuery) {
  return useQuery({
    queryKey: ['customers', query],
    queryFn: () => fetchCustomers(query),
  });
}

export function useCustomer(id: number | null) {
  return useQuery({
    queryKey: ['customer', id],
    queryFn: () => fetchCustomer(id!),
    enabled: id !== null,
  });
}

export function useCustomerOptions() {
  return useQuery({
    queryKey: ['customer-options'],
    queryFn: fetchCustomerOptions,
    staleTime: 60_000,
  });
}

export function useCustomerContacts(customerId: number | null) {
  return useQuery({
    queryKey: ['customer-contacts', customerId],
    queryFn: () => fetchCustomerContacts(customerId!),
    enabled: customerId !== null,
  });
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createCustomer,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer-options'] });
    },
  });
}

export function useUpdateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<CreateCustomerPayload> }) =>
      updateCustomer(id, payload),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer', id] });
      qc.invalidateQueries({ queryKey: ['customer-options'] });
    },
  });
}

export function useCreateCustomerContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, payload }: { customerId: number; payload: CreateContactPayload }) =>
      createCustomerContact(customerId, payload),
    onSuccess: (_, { customerId }) => {
      qc.invalidateQueries({ queryKey: ['customer-contacts', customerId] });
    },
  });
}

export function useDeleteCustomerContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contactId, customerId }: { contactId: number; customerId: number }) =>
      deleteCustomerContact(customerId, contactId),
    onSuccess: (_, { customerId }) => {
      qc.invalidateQueries({ queryKey: ['customer-contacts', customerId] });
    },
  });
}

/** Hook: 启用/禁用客户 */
export function usePatchCustomerStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: CustomerStatus }) =>
      patchCustomerStatus(id, status),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer', id] });
    },
  });
}

/** Hook: 更新联系人 */
export function useUpdateCustomerContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      customerId,
      contactId,
      payload,
    }: {
      customerId: number;
      contactId: number;
      payload: Partial<CreateContactPayload>;
    }) => updateCustomerContact(customerId, contactId, payload),
    onSuccess: (_, { customerId }) => {
      qc.invalidateQueries({ queryKey: ['customer-contacts', customerId] });
    },
  });
}

/** Hook: 获取客户关联订单（最近 5 条） */
export function useCustomerOrders(customerId: number | null) {
  return useQuery({
    queryKey: ['customer-orders', customerId],
    queryFn: () => fetchCustomerOrders(customerId!, { pageSize: 5 }),
    enabled: customerId !== null,
  });
}
