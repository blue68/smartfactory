import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import InventoryOperationReportPage from '@/pages/report/InventoryOperationReportPage';

const mocks = vi.hoisted(() => ({
  useInventoryOperationReport: vi.fn(),
  setPageTitle: vi.fn(),
}));

vi.mock('@/api/analytics', () => ({
  useInventoryOperationReport: mocks.useInventoryOperationReport,
}));

vi.mock('@/stores/appStore', () => ({
  useAppStore: () => ({
    setPageTitle: mocks.setPageTitle,
  }),
}));

const reportData = {
  summary: {
    totalInventoryValue: '120000.00',
    avgTurnoverDays: '46.5',
    highRiskSkuCount: 1,
    healthScore: '78',
  },
  quadrantThresholds: {
    inventoryValue: '30000',
    turnoverDays: '45',
  },
  structureHealth: {
    score: '78',
    healthyAmountPct: '52%',
    warningAmountPct: '18%',
    dangerousAmountPct: '20%',
    highValueRiskPct: '10%',
  },
  riskDistribution: [
    { riskLevel: 'healthy' as const, count: 2, pct: '66%' },
    { riskLevel: 'high' as const, count: 1, pct: '34%' },
  ],
  quadrantAmountSummary: [
    { quadrant: 'core' as const, label: '核心动销', inventoryValue: '40000', pct: '33%', skuCount: 1 },
    { quadrant: 'capital_risk' as const, label: '资金占压', inventoryValue: '50000', pct: '42%', skuCount: 1 },
    { quadrant: 'light_fast' as const, label: '轻量快动', inventoryValue: '30000', pct: '25%', skuCount: 1 },
  ],
  categoryValueBreakdown: [
    { categoryName: '面料', inventoryValue: '60000', pct: '50%', skuCount: 2 },
    { categoryName: '辅料', inventoryValue: '60000', pct: '50%', skuCount: 1 },
  ],
  categoryTurnover: [
    { categoryName: '面料', turnoverDays: '30', skuCount: 2 },
    { categoryName: '辅料', turnoverDays: '55', skuCount: 1 },
  ],
  quadrantBubble: [
    {
      skuId: 1,
      skuCode: 'SKU-001',
      skuName: '高弹面料',
      inventoryValue: '52000',
      turnoverDays: '68',
      qtyOnHand: '150',
      bubbleSize: 18,
      quadrant: 'capital_risk' as const,
      abcClass: 'A' as const,
      riskIndex: 88,
      riskLevel: 'high' as const,
    },
    {
      skuId: 2,
      skuCode: 'SKU-002',
      skuName: '木脚组件',
      inventoryValue: '12000',
      turnoverDays: '18',
      qtyOnHand: '48',
      bubbleSize: 14,
      quadrant: 'light_fast' as const,
      abcClass: 'B' as const,
      riskIndex: 36,
      riskLevel: 'healthy' as const,
    },
  ],
  riskLeaderboard: [
    {
      skuId: 1,
      skuCode: 'SKU-001',
      skuName: '高弹面料',
      categoryName: '面料',
      qtyOnHand: '150.00',
      inventoryValue: '52000.00',
      outboundPeriodQty: '32.00',
      lastOutboundDate: '2026-04-01',
      stagnantDays: '11',
      turnoverDays: '68.0',
      quadrant: 'capital_risk' as const,
      abcClass: 'A' as const,
      riskIndex: 88,
      riskLevel: 'high' as const,
    },
  ],
  stagnantSkuTop50: [],
};

describe('InventoryOperationReportPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useInventoryOperationReport.mockReturnValue({
      data: reportData,
      isLoading: false,
    });
  });

  it('hover 气泡时应展示 SKU 编码与名称', async () => {
    render(<InventoryOperationReportPage />);

    const bubble = screen.getByRole('button', { name: 'SKU-001 高弹面料' });
    fireEvent.mouseEnter(bubble);

    await waitFor(() => {
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
    });

    const tooltip = screen.getByRole('tooltip');
    expect(within(tooltip).getByText('SKU-001')).toBeInTheDocument();
    expect(within(tooltip).getByText('高弹面料')).toBeInTheDocument();
    expect(bubble).toHaveAttribute('title', 'SKU-001 | 高弹面料');
  });

  it('按 SKU 编码或名称筛选后应动态更新图表气泡', async () => {
    render(<InventoryOperationReportPage />);

    expect(screen.getByText('已显示 2 / 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SKU-001 高弹面料' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SKU-002 木脚组件' })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('筛选 SKU 编码或名称'), {
      target: { value: '木脚' },
    });

    await waitFor(() => {
      expect(screen.getByText('已显示 1 / 2')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: 'SKU-001 高弹面料' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SKU-002 木脚组件' })).toBeInTheDocument();
  });

  it('仅保留风险排行 TOP50 榜，并展示最后出库日期和呆滞天数', () => {
    render(<InventoryOperationReportPage />);

    expect(screen.getByRole('heading', { name: '风险排行 TOP50榜' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '呆滞库存 TOP 50（按呆滞天数）' })).not.toBeInTheDocument();
    expect(screen.getByText('最后出库日期')).toBeInTheDocument();
    expect(screen.getByText('呆滞天数')).toBeInTheDocument();
    expect(screen.getByText('2026-04-01')).toBeInTheDocument();
    expect(screen.getByText('11')).toBeInTheDocument();
  });
});
