/**
 * [artifact:前端代码] — 状态徽章（自动映射各业务状态到语义色）
 */

import Tag from './Tag';
import type { TagVariant } from './Tag';
import {
  SuggestionStatusLabel, SalesOrderStatusLabel, ProductionOrderStatusLabel,
  BomStatusLabel, PurchaseOrderStatusLabel, MatchStatusLabel,
  InspectionStatusLabel, TaskStatusLabel,
  SuggestionStatus, SalesOrderStatus, ProductionOrderStatus,
  BomStatus, PurchaseOrderStatus, MatchStatus,
  InspectionStatus, TaskStatus,
} from '@/types/enums';

type AnyStatus =
  | SuggestionStatus | SalesOrderStatus | ProductionOrderStatus
  | BomStatus | PurchaseOrderStatus | MatchStatus
  | InspectionStatus | TaskStatus;

const VARIANT_MAP: Record<string, TagVariant> = {
  // 通用
  pending:          'warning',
  pending_approval: 'warning',
  approved:         'success',
  rejected:         'error',
  executed:         'info',
  expired:          'neutral',
  // BOM
  draft:            'neutral',
  active:           'success',
  archived:         'neutral',
  // 采购订单
  confirmed:        'info',
  partial:          'warning',
  completed:        'success',
  cancelled:        'neutral',
  // 销售订单
  in_production:    'info',
  // 三单匹配
  matched:          'success',
  qty_diff:         'warning',
  price_diff:       'warning',
  price_warning:    'warning',
  // 生产工单
  in_progress:      'info',
  paused:           'warning',
  // 任务
  skipped:          'neutral',
  // 质检
  passed:           'success',
  failed:           'error',
};

const ALL_LABELS: Record<string, string> = {
  ...SuggestionStatusLabel,
  ...SalesOrderStatusLabel,
  ...ProductionOrderStatusLabel,
  ...BomStatusLabel,
  ...PurchaseOrderStatusLabel,
  ...MatchStatusLabel,
  ...InspectionStatusLabel,
  ...TaskStatusLabel,
};

interface StatusBadgeProps {
  status: AnyStatus | string;
  className?: string;
}

export default function StatusBadge({ status, className }: StatusBadgeProps) {
  const variant: TagVariant = VARIANT_MAP[status] ?? 'neutral';
  const label = ALL_LABELS[status] ?? status;
  return <Tag variant={variant} className={className}>{label}</Tag>;
}
