import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';
import type { PaginatedData } from '@/types/api';
import type {
  AssetCard,
  AssetReturnPayload,
  AssetScrapPayload,
  AssetTransferPayload,
  CreateAssetAcceptancePayload,
} from '@/types/models';

export const assetKeys = {
  all: ['assets'] as const,
  cards: () => [...assetKeys.all, 'cards'] as const,
  cardList: (params?: { status?: string; departmentId?: number; keyword?: string; page?: number; pageSize?: number }) =>
    [...assetKeys.cards(), 'list', params] as const,
  cardDetail: (id: number) => [...assetKeys.cards(), 'detail', id] as const,
};

export const assetApi = {
  getCards: (params?: { status?: string; departmentId?: number; keyword?: string; page?: number; pageSize?: number }) =>
    request.get<PaginatedData<AssetCard>>(
      '/api/assets/cards',
      params as Record<string, unknown>,
    ),

  getCardById: (id: number) =>
    request.get<AssetCard>(`/api/assets/cards/${id}`),

  acceptAssets: (payload: CreateAssetAcceptancePayload) =>
    request.post<{ receiptId: number; createdCount: number; cards: Array<{ id: number; assetNo: string; receiptItemId: number }> }>(
      '/api/assets/acceptance',
      payload,
    ),

  transferCard: (id: number, payload: AssetTransferPayload) =>
    request.post<null>(`/api/assets/cards/${id}/transfer`, payload),

  returnCard: (id: number, payload: AssetReturnPayload) =>
    request.post<null>(`/api/assets/cards/${id}/return`, payload),

  scrapCard: (id: number, payload: AssetScrapPayload) =>
    request.post<null>(`/api/assets/cards/${id}/scrap`, payload),
};

export function useAssetCardList(params?: { status?: string; departmentId?: number; keyword?: string; page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: assetKeys.cardList(params),
    queryFn: () => assetApi.getCards(params),
    placeholderData: (previous) => previous,
  });
}

export function useAssetCardDetail(id: number | null) {
  return useQuery({
    queryKey: assetKeys.cardDetail(id!),
    queryFn: () => assetApi.getCardById(id!),
    enabled: id !== null && id > 0,
    placeholderData: (previous) => previous,
  });
}

export function useCreateAssetAcceptance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: assetApi.acceptAssets,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: assetKeys.cards() });
    },
  });
}

export function useReturnAssetCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: AssetReturnPayload }) =>
      assetApi.returnCard(id, payload),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: assetKeys.cards() });
      void qc.invalidateQueries({ queryKey: assetKeys.cardDetail(variables.id) });
    },
  });
}

export function useTransferAssetCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: AssetTransferPayload }) =>
      assetApi.transferCard(id, payload),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: assetKeys.cards() });
      void qc.invalidateQueries({ queryKey: assetKeys.cardDetail(variables.id) });
    },
  });
}

export function useScrapAssetCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: AssetScrapPayload }) =>
      assetApi.scrapCard(id, payload),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: assetKeys.cards() });
      void qc.invalidateQueries({ queryKey: assetKeys.cardDetail(variables.id) });
    },
  });
}
