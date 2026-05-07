/**
 * [artifact:前端代码] — 采购价格批量导入向导
 * R-03 Sprint 1 + Gap Fix (G02/G03/G04/G05/G09/G10/G11/G14/G15)
 *
 * 功能：
 *   - Step1：下载模板（含列说明规格表）
 *             G02/G03/G04: TEMPLATE_COLUMNS 对齐设计稿
 *               A=SKU编码, B=供应商编码, C=单价, D=货币单位(CNY/USD/EUR),
 *               E=含税标记(是/否), F=报价日期(YYYY-MM-DD), G=备注
 *   - Step2：拖拽/点击上传 .xlsx/.xls 文件
 *             FE-03-01: 大文件（>500KB）解析时显示进度条
 *             FE-03-05: 4 种解析状态反馈（解析中/成功/警告/错误过多）
 *             G05: 上传完成后显示解析行数
 *   - Step3：预览校验结果（错误行红色 / 警告行黄色 / 重复行黄绿色）
 *             FE-03-02: 错误 > 50 条时显示错误过多状态，隐藏明细表
 *             FE-03-03: 价格异常行黄色高亮 + 确认异常复选框
 *             G09: 增加「重复追加」chip 统计
 *             G10: 预览表格展示原始数据列（行号/SKU/供应商/单价/货币/含税/日期/备注/状态）
 *             G11: 表格头部「下载错误明细」按钮
 *   - Step3 → Step4 过渡：导入执行中进度条（G14）
 *             显示进度条，2 秒间隔模拟轮询更新（如后端有轮询接口则接入）
 *             增加「终止导入」按钮
 *   - Step4：导入结果展示（成功数 / 失败数）
 *             FE-03-04: 失败行时显示"下载失败明细"按钮
 *             G15: 增加「跳过错误行」独立卡片 + 「再次导入」按钮
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import { priceApi } from '@/api/price';
import type { ImportResult, ImportRowIssue } from '@/api/price';
import styles from './PriceImport.module.css';

// ─────────────────────────────────────────────
// 类型 & 常量
// ─────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4;
type HandleMode = 'import-valid' | 'abort-all';

/** FE-03-05: 解析状态类型 */
type ParseState = 'idle' | 'parsing' | 'success' | 'warning' | 'error';

/** 导入执行阶段（G14: 进度条） */
type ImportingPhase = 'idle' | 'running' | 'aborted';

/** 大文件阈值：500KB */
const LARGE_FILE_THRESHOLD = 512000;

/** 错误过多阈值 */
const TOO_MANY_ERRORS_THRESHOLD = 50;

/** 价格异常偏差阈值：30% */
const PRICE_ANOMALY_THRESHOLD = 0.3;

const STEP_LABELS = ['下载模板', '上传文件', '预览校验', '确认导入'];
const ACCEPTED_EXTS = ['.xlsx', '.xls'];
const MAX_FILE_SIZE_MB = 10;

/**
 * G02/G03/G04: 模板列字段定义对齐设计稿
 * 列顺序：A=SKU编码, B=供应商编码, C=单价, D=货币单位, E=含税标记, F=报价日期, G=备注
 */
const TEMPLATE_COLUMNS = [
  { col: 'A', name: 'SKU 编码',  required: true,  note: '与系统 SKU 编码精确匹配，文本格式' },
  { col: 'B', name: '供应商编码', required: true,  note: '与系统供应商编码精确匹配，文本格式' },
  { col: 'C', name: '单价',       required: true,  note: '正数，保留 2 位小数，不允许负数' },
  { col: 'D', name: '货币单位',   required: true,  note: '枚举：CNY / USD / EUR（下拉选项）' },
  { col: 'E', name: '含税标记',   required: true,  note: '枚举：是 / 否（下拉选项）' },
  { col: 'F', name: '报价日期',   required: true,  note: '日期格式：YYYY-MM-DD' },
  { col: 'G', name: '备注',       required: false, note: '文本，最大 200 字' },
] as const;

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

/** 判断某行是否为价格异常行（偏差 > 30%） */
function isAnomalyRow(issue: ImportRowIssue): boolean {
  if (
    issue.importedPrice !== undefined &&
    issue.historicalPrice !== undefined &&
    issue.historicalPrice > 0
  ) {
    const deviation = Math.abs(issue.importedPrice - issue.historicalPrice) / issue.historicalPrice;
    return deviation > PRICE_ANOMALY_THRESHOLD;
  }
  return false;
}

/**
 * FE-03-04: 生成并下载失败明细 CSV
 * 文件名格式：价格导入失败明细_{YYYYMMDD_HHmmss}.csv
 */
function downloadFailedDetailCSV(errors: ImportRowIssue[], filename?: string): void {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  const datePart = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join('');
  const timePart = [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
  const defaultFilename = `价格导入失败明细_${datePart}_${timePart}.csv`;

  // 构建 CSV 内容 — 包含原始数据列（G10）
  const headers = ['行号', 'SKU编码', '供应商编码', '单价', '货币单位', '含税标记', '报价日期', '备注', '错误列', '错误原因'];
  const rows = errors.map((err) => [
    `第 ${err.row} 行`,
    err.rawData?.['SKU编码'] ?? err.rawData?.['sku_code'] ?? '',
    err.rawData?.['供应商编码'] ?? err.rawData?.['supplier_code'] ?? '',
    err.rawData?.['单价'] ?? err.rawData?.['unit_price'] ?? (err.importedPrice !== undefined ? String(err.importedPrice) : ''),
    err.rawData?.['货币单位'] ?? err.rawData?.['currency'] ?? '',
    err.rawData?.['含税标记'] ?? err.rawData?.['tax_inclusive'] ?? '',
    err.rawData?.['报价日期'] ?? err.rawData?.['quote_date'] ?? '',
    err.rawData?.['备注'] ?? err.rawData?.['notes'] ?? '',
    err.column ?? '',
    err.message,
  ]);

  const csvLines = [headers, ...rows].map((cols) =>
    cols.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  );
  // BOM for Excel UTF-8 recognition
  const bom = '\uFEFF';
  const csvContent = bom + csvLines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? defaultFilename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────
// 子组件：步骤条
// ─────────────────────────────────────────────

function WizardStepper({ current }: { current: Step }) {
  return (
    <div className={styles.stepper}>
      {STEP_LABELS.map((label, idx) => {
        const stepNum = (idx + 1) as Step;
        const isDone    = stepNum < current;
        const isActive  = stepNum === current;

        const circleClass = isDone
          ? styles['step__circle--done']
          : isActive
          ? styles['step__circle--active']
          : styles['step__circle--pending'];

        const labelClass = isDone
          ? styles['step__label--done']
          : isActive
          ? styles['step__label--active']
          : styles['step__label--pending'];

        return (
          <div key={stepNum} className={styles.step}>
            {/* 前置连接线（第一步不显示） */}
            {idx > 0 && (
              <div
                className={`${styles.connector} ${isDone || isActive ? styles['connector--done'] : styles['connector--pending']}`}
              />
            )}
            <div className={styles.step__inner}>
              <div className={`${styles.step__circle} ${circleClass}`}>
                {isDone ? '✓' : stepNum}
              </div>
              <span className={`${styles.step__label} ${labelClass}`}>{label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────
// 子组件：Step1 — 下载模板
// ─────────────────────────────────────────────

function Step1Download({ onNext }: { onNext: () => void }) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      await priceApi.downloadTemplate();
    } catch (e) {
      console.error('[PriceImport] downloadTemplate error:', e);
    } finally {
      setDownloading(false);
    }
  }, []);

  return (
    <div className={styles.body} key="step1">
      <div className={styles.stepCard}>
        <div className={styles.stepCard__title}>
          <div className={styles.stepCard__icon}>📋</div>
          第一步：下载导入模板
        </div>
        <p className={styles.stepCard__desc}>
          请先下载标准 Excel 模板，按照模板格式填写历史采购价格数据后，再进行上传。模板内已预设数据有效性校验（货币单位、含税标记为下拉选项）。
        </p>

        <div className={styles.templateBox}>
          {/* 文件下载卡片 */}
          <button
            type="button"
            className={styles.templateFileCard}
            onClick={handleDownload}
            disabled={downloading}
            aria-label="下载采购价格导入模板"
          >
            <span className={styles.templateFileCard__icon}>
              {downloading ? '⏳' : '📊'}
            </span>
            <span className={styles.templateFileCard__name}>
              {downloading ? '下载中...' : '采购价格导入模板_v1.xlsx'}
            </span>
            <span className={styles.templateFileCard__hint}>
              {downloading ? '请稍候' : '约 28 KB · 含示例数据'}
            </span>
          </button>

          {/* 列说明规格表 — G02/G03/G04 已对齐设计稿 */}
          <div className={styles.specWrap}>
            <div className={styles.specTitle}>
              <span>📌</span> 模板字段说明（7 列，列顺序固定）
            </div>
            <table className={styles.specTable}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>列名</th>
                  <th>必填</th>
                  <th>格式要求</th>
                </tr>
              </thead>
              <tbody>
                {TEMPLATE_COLUMNS.map((col) => (
                  <tr key={col.col}>
                    <td>{col.col}</td>
                    <td>{col.name}</td>
                    <td>
                      <span className={`${styles.specTag} ${col.required ? styles['specTag--required'] : styles['specTag--optional']}`}>
                        {col.required ? '必填' : '选填'}
                      </span>
                    </td>
                    <td>{col.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={styles.templateNote}>
              <span>⚠️</span>
              <span>请勿修改模板中的列名和顺序；第一行为表头（加粗），第二行为示例（灰色），从第三行填写数据。</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        <div className={styles.footer__left} />
        <div className={styles.footer__right}>
          <Button variant="primary" onClick={onNext}>
            下一步：上传文件 →
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 子组件：Step2 — 上传文件
// ─────────────────────────────────────────────

interface Step2UploadProps {
  selectedFile: File | null;
  onFileChange: (file: File | null) => void;
  onPrev: () => void;
  onNext: () => void;
  uploading: boolean;
  uploadProgress: number;
  uploadError: string | null;
  /** FE-03-01: 是否显示大文件解析进度条（文件 > 500KB） */
  showParseProgress: boolean;
  parseProgress: number;
  /** FE-03-05: 当前解析状态 */
  parseState: ParseState;
  parseResult: ImportResult | null;
}

function Step2Upload({
  selectedFile,
  onFileChange,
  onPrev,
  onNext,
  uploading,
  uploadProgress,
  uploadError,
  showParseProgress,
  parseProgress,
  parseState,
  parseResult,
}: Step2UploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const validateAndSet = useCallback((file: File) => {
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
    if (!ACCEPTED_EXTS.includes(ext as typeof ACCEPTED_EXTS[number])) {
      alert('仅支持 .xlsx 或 .xls 格式文件');
      return;
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      alert(`文件大小不得超过 ${MAX_FILE_SIZE_MB}MB`);
      return;
    }
    onFileChange(file);
  }, [onFileChange]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) validateAndSet(file);
  }, [validateAndSet]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) validateAndSet(file);
    // 重置 input，允许重新选择相同文件
    e.target.value = '';
  }, [validateAndSet]);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // FE-03-05: 渲染解析状态反馈块
  const renderParseStatus = () => {
    if (parseState === 'idle') return null;

    if (parseState === 'parsing') {
      return (
        <div className={`${styles.parseStatus} ${styles['parseStatus--parsing']}`}>
          <span className={styles.parseStatus__spinner} aria-hidden="true" />
          <span className={styles.parseStatus__text}>正在解析文件...</span>
        </div>
      );
    }

    if (parseState === 'success' && parseResult) {
      // G05: 显示解析行数
      const totalRows = parseResult.totalCount ?? (parseResult.successCount + parseResult.failCount);
      return (
        <div className={`${styles.parseStatus} ${styles['parseStatus--success']}`}>
          <span className={styles.parseStatus__icon}>✅</span>
          <span className={styles.parseStatus__text}>
            文件解析完成，共 <strong>{totalRows.toLocaleString()}</strong> 行，
            <strong>{parseResult.successCount}</strong> 条有效记录
          </span>
        </div>
      );
    }

    if (parseState === 'warning' && parseResult) {
      const totalRows = parseResult.totalCount ?? (parseResult.successCount + parseResult.failCount);
      const issueCount = parseResult.errors.length + parseResult.warnings.length;
      return (
        <div className={`${styles.parseStatus} ${styles['parseStatus--warning']}`}>
          <span className={styles.parseStatus__icon}>⚠️</span>
          <span className={styles.parseStatus__text}>
            共 <strong>{totalRows.toLocaleString()}</strong> 行，发现 <strong>{issueCount}</strong> 条问题，请检查后继续
          </span>
        </div>
      );
    }

    if (parseState === 'error' && parseResult) {
      return (
        <div className={`${styles.parseStatus} ${styles['parseStatus--error']}`}>
          <span className={styles.parseStatus__icon}>❌</span>
          <span className={styles.parseStatus__text}>
            错误行数过多（<strong>{parseResult.errors.length}</strong> 条），请检查文件格式后重新上传
          </span>
        </div>
      );
    }

    return null;
  };

  return (
    <div className={styles.body} key="step2">
      <div className={styles.stepCard}>
        <div className={styles.stepCard__title}>
          <div className={styles.stepCard__icon}>📁</div>
          第二步：上传价格文件
        </div>
        <p className={styles.stepCard__desc}>
          上传填写好的 Excel 文件，系统将自动解析并校验数据。仅支持 .xlsx / .xls 格式，文件大小不超过 {MAX_FILE_SIZE_MB}MB。
        </p>

        {/* 拖拽上传区 / 已选文件展示 */}
        {!selectedFile ? (
          <div
            className={`${styles.uploadZone} ${isDragging ? styles['uploadZone--dragover'] : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            aria-label="点击或拖拽上传文件"
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
          >
            <span className={styles.uploadZone__icon}>📂</span>
            <span className={styles.uploadZone__title}>
              {isDragging ? '松开即可上传' : '拖拽文件到此处，或点击选择'}
            </span>
            <span className={styles.uploadZone__subtitle}>仅支持 .xlsx / .xls 格式</span>
            <Button variant="primary" size="sm" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
              📎 选择文件
            </Button>
            <span className={styles.uploadZone__note}>单次上传最大 {MAX_FILE_SIZE_MB} MB · 最多 5000 行数据</span>
          </div>
        ) : (
          <div className={styles.fileCard}>
            <span className={styles.fileCard__icon}>📊</span>
            <div className={styles.fileCard__info}>
              <div className={styles.fileCard__name}>{selectedFile.name}</div>
              <div className={styles.fileCard__meta}>
                {formatFileSize(selectedFile.size)} · {selectedFile.name.split('.').pop()?.toUpperCase()} 格式
              </div>
            </div>
            <span className={styles.fileCard__badge}>✓ 格式正确</span>
            <button
              type="button"
              className={styles.fileCard__removebtn}
              onClick={() => onFileChange(null)}
              aria-label="移除文件"
              disabled={uploading}
            >
              ✕ 移除
            </button>
          </div>
        )}

        {/* FE-03-01: 大文件解析进度条（文件 > 500KB 且正在上传时显示） */}
        {showParseProgress && uploading && (
          <div className={styles.parseProgressWrap}>
            <div className={styles.parseProgressWrap__header}>
              <span className={styles.parseProgressWrap__label}>
                <span className={styles.uploadingBar__spinner} aria-hidden="true" />
                正在解析文件，请稍候...
              </span>
              <span className={styles.parseProgressWrap__pct}>{parseProgress}%</span>
            </div>
            <div
              className={styles.progressBar}
              role="progressbar"
              aria-valuenow={parseProgress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className={styles.progressFill} style={{ width: `${parseProgress}%` }} />
            </div>
          </div>
        )}

        {/* 普通上传进度条（文件 <= 500KB 时使用原有样式） */}
        {uploading && !showParseProgress && (
          <div className={styles.uploadingBar}>
            <div className={styles.uploadingBar__header}>
              <span className={styles.uploadingBar__label}>
                <span className={styles.uploadingBar__spinner} />
                正在上传并校验，请稍候...
              </span>
              <span style={{ color: 'var(--color-primary-600)', fontWeight: 600, fontFamily: 'var(--font-family-number)' }}>
                {uploadProgress}%
              </span>
            </div>
            <div className={styles.progressBar}>
              <div className={styles.progressBar__fill} style={{ width: `${uploadProgress}%` }} />
            </div>
          </div>
        )}

        {/* FE-03-05: 解析状态反馈 */}
        {!uploading && renderParseStatus()}

        {/* 上传错误提示 */}
        {uploadError && !uploading && (
          <div className={styles.errorBanner}>
            <span className={styles.errorBanner__icon}>⚠️</span>
            <span>{uploadError}</span>
          </div>
        )}

        {/* 上传限制说明 */}
        <div className={styles.uploadLimits} style={{ marginTop: 'var(--space-4)' }}>
          <div className={styles.uploadLimitItem}>
            <span>📋</span> 格式：.xlsx / .xls
          </div>
          <div className={styles.uploadLimitItem}>
            <span>📏</span> 大小：≤ {MAX_FILE_SIZE_MB}MB
          </div>
          <div className={styles.uploadLimitItem}>
            <span>🔢</span> 行数：≤ 5,000 行（含表头不算）
          </div>
          <div className={styles.uploadLimitItem}>
            <span>🌐</span> 编码：UTF-8
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        <div className={styles.footer__left}>
          <Button variant="ghost" onClick={onPrev} disabled={uploading}>
            ← 上一步
          </Button>
        </div>
        <div className={styles.footer__right}>
          <Button
            variant="primary"
            onClick={onNext}
            disabled={!selectedFile || uploading || parseState === 'parsing'}
            loading={uploading}
          >
            {uploading ? '校验中...' : '下一步：预览校验 →'}
          </Button>
        </div>
      </div>

      {/* 隐藏 input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: 'none' }}
        onChange={handleInputChange}
        aria-hidden="true"
      />
    </div>
  );
}

// ─────────────────────────────────────────────
// 子组件：Step3 — 预览校验
// ─────────────────────────────────────────────

interface Step3PreviewProps {
  result: ImportResult;
  handleMode: HandleMode;
  onHandleModeChange: (mode: HandleMode) => void;
  onPrev: () => void;
  onConfirm: () => void;
  confirming: boolean;
  /** FE-03-03: 异常确认状态 */
  anomalyConfirmed: boolean;
  onAnomalyConfirmedChange: (checked: boolean) => void;
}

function Step3Preview({
  result,
  handleMode,
  onHandleModeChange,
  onPrev,
  onConfirm,
  confirming,
  anomalyConfirmed,
  onAnomalyConfirmedChange,
}: Step3PreviewProps) {
  const totalRows = result.totalCount ?? (result.successCount + result.failCount);
  const hasErrors   = result.errors.length > 0;
  const hasWarnings = result.warnings.length > 0;

  // G09: 重复追加行数
  const duplicateCount = result.duplicateCount ?? result.duplicates?.length ?? 0;
  const hasDuplicates = duplicateCount > 0;

  // FE-03-02: 检测错误过多状态
  const tooManyErrors = result.errors.length > TOO_MANY_ERRORS_THRESHOLD;

  // FE-03-03: 从 result.anomalies 或 result.warnings 中检测价格异常行
  const anomalyRows: ImportRowIssue[] = [
    ...(result.anomalies ?? []),
    ...result.warnings.filter(isAnomalyRow),
  ];
  // 去重（按行号）
  const anomalyRowNumbers = new Set(anomalyRows.map((r) => r.row));
  const hasAnomalies = anomalyRowNumbers.size > 0;

  // G10: 合并所有行类型用于表格展示（错误 + 警告 + 重复），按行号排序
  type IssueRow = ImportRowIssue & { type: 'error' | 'warning' | 'duplicate' };
  const allIssues: IssueRow[] = [
    ...result.errors.map((e) => ({ ...e, type: 'error' as const })),
    ...result.warnings.map((w) => ({ ...w, type: 'warning' as const })),
    ...(result.duplicates ?? []).map((d) => ({ ...d, type: 'duplicate' as const })),
  ].sort((a, b) => a.row - b.row);

  // FE-03-03: 是否禁用导入按钮（有异常行且未确认时禁用）
  const importDisabled =
    confirming ||
    (handleMode === 'import-valid' && result.successCount === 0) ||
    (hasAnomalies && !anomalyConfirmed);

  // G11: 下载错误明细（Step3 内）
  const handleDownloadErrorDetail = useCallback(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    downloadFailedDetailCSV(result.errors, `价格校验错误明细_${ts}.csv`);
  }, [result.errors]);

  /** 从 rawData 中提取 G10 所需的展示列值 */
  const getRawField = (issue: ImportRowIssue, fieldKeys: string[]): string => {
    if (!issue.rawData) return '—';
    for (const key of fieldKeys) {
      const val = issue.rawData[key];
      if (val !== undefined && val !== null && val !== '') return String(val);
    }
    return '—';
  };

  return (
    <div className={styles.body} key="step3">
      <div className={styles.stepCard}>
        <div className={styles.stepCard__title}>
          <div className={styles.stepCard__icon}>🔍</div>
          第三步：数据预览与校验
        </div>
        <p className={styles.stepCard__desc}>
          系统已完成校验，请查看下方结果并选择处理方式。
        </p>

        {/* 统计 chips — G09: 增加重复追加 chip */}
        <div className={styles.previewStats}>
          <div className={`${styles.statChip} ${styles['statChip--total']}`}>
            <span className={styles.statChip__num}>{totalRows.toLocaleString()}</span>
            <span>共 X 行</span>
          </div>
          <div className={`${styles.statChip} ${styles['statChip--success']}`}>
            <span className={styles.statChip__num}>{result.successCount.toLocaleString()}</span>
            <span>正确行</span>
          </div>
          {hasErrors && (
            <div className={`${styles.statChip} ${styles['statChip--error']}`}>
              <span className={styles.statChip__num}>{result.failCount}</span>
              <span>错误行</span>
            </div>
          )}
          {/* G09: 重复追加行 chip */}
          {hasDuplicates && (
            <div className={`${styles.statChip} ${styles['statChip--info']}`}>
              <span className={styles.statChip__num}>{duplicateCount}</span>
              <span>重复追加</span>
            </div>
          )}
          {hasWarnings && (
            <div className={`${styles.statChip} ${styles['statChip--warning']}`}>
              <span className={styles.statChip__num}>{result.warnings.length}</span>
              <span>价格偏高警告</span>
            </div>
          )}
        </div>

        {/* FE-03-02: 错误过多状态 — 替换整个结果区域，隐藏错误明细表 */}
        {tooManyErrors ? (
          <div className={styles.errorOverflow}>
            <span className={styles.errorOverflow__icon}>🚫</span>
            <div className={styles.errorOverflow__title}>错误行数过多</div>
            <div className={styles.errorOverflow__message}>
              错误行数过多（{result.errors.length} 条），请检查文件格式后重新上传
            </div>
          </div>
        ) : (
          <>
            {/* 处理方式选择（仅当有错误行时展示） */}
            {hasErrors && (
              <div className={styles.handleOptions}>
                <label
                  className={`${styles.handleOption} ${handleMode === 'import-valid' ? styles['handleOption--selected'] : ''}`}
                >
                  <input
                    type="radio"
                    name="handleMode"
                    className={styles.handleOption__radio}
                    checked={handleMode === 'import-valid'}
                    onChange={() => onHandleModeChange('import-valid')}
                  />
                  <div className={styles.handleOption__text}>
                    <div className={styles.handleOption__label}>跳过错误行，仅导入正确行</div>
                    <div className={styles.handleOption__desc}>
                      将导入 {result.successCount} 条正确数据，跳过 {result.failCount} 条错误行（推荐）
                    </div>
                  </div>
                </label>
                <label
                  className={`${styles.handleOption} ${handleMode === 'abort-all' ? styles['handleOption--selected'] : ''}`}
                >
                  <input
                    type="radio"
                    name="handleMode"
                    className={styles.handleOption__radio}
                    checked={handleMode === 'abort-all'}
                    onChange={() => onHandleModeChange('abort-all')}
                  />
                  <div className={styles.handleOption__text}>
                    <div className={styles.handleOption__label}>取消导入，修正后重新上传</div>
                    <div className={styles.handleOption__desc}>
                      放弃本次操作，下载错误明细后修正 Excel 再重新上传
                    </div>
                  </div>
                </label>
              </div>
            )}

            {/* 全部合法时提示 */}
            {!hasErrors && (
              <div className={styles.allOkBanner}>
                <span>✅</span>
                <span>数据校验通过，全部 {result.successCount} 行均合法，可直接导入。</span>
              </div>
            )}

            {/* G10: 问题行表格 — 展示原始数据列 */}
            {allIssues.length > 0 && (
              <div className={styles.previewTableWrap} style={{ marginTop: 'var(--space-4)' }}>
                <div className={styles.previewTableHeader}>
                  {/* G11: 下载错误明细按钮 */}
                  <span>
                    共 {totalRows.toLocaleString()} 行，当前显示前 100 行（折叠显示）
                  </span>
                  {hasErrors && (
                    <button
                      type="button"
                      className={styles.downloadDetailBtn}
                      onClick={handleDownloadErrorDetail}
                    >
                      ⬇ 下载错误明细
                    </button>
                  )}
                </div>
                <div className={styles.previewScroll}>
                  {/* G10: 表头含原始数据列 */}
                  <table className={styles.previewTable}>
                    <thead>
                      <tr>
                        <th>行号</th>
                        <th>SKU 编码</th>
                        <th>供应商编码</th>
                        <th>单价</th>
                        <th>货币单位</th>
                        <th>含税标记</th>
                        <th>报价日期</th>
                        <th>备注</th>
                        <th>状态 / 原因</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allIssues.slice(0, 100).map((issue, i) => {
                        // FE-03-03: 价格异常行使用 anomalyRow 样式
                        const isAnomaly = issue.type === 'warning' && anomalyRowNumbers.has(issue.row);
                        const rowClass = issue.type === 'error'
                          ? styles['row--error']
                          : issue.type === 'duplicate'
                          ? styles['row--duplicate']
                          : isAnomaly
                          ? styles.anomalyRow
                          : styles['row--warning'];

                        return (
                          <tr key={i} className={rowClass}>
                            <td>{issue.row}</td>
                            {/* G10: 原始数据列 */}
                            <td>{getRawField(issue, ['SKU编码', 'sku_code', 'skuCode'])}</td>
                            <td>{getRawField(issue, ['供应商编码', 'supplier_code', 'supplierCode'])}</td>
                            <td>
                              {issue.type === 'error' && issue.column?.includes('单价') ? (
                                <span className={styles.cellError}>{getRawField(issue, ['单价', 'unit_price', 'unitPrice'])}</span>
                              ) : issue.type === 'warning' ? (
                                <span className={styles.cellWarn}>{issue.importedPrice !== undefined ? String(issue.importedPrice) : getRawField(issue, ['单价', 'unit_price', 'unitPrice'])}</span>
                              ) : (
                                getRawField(issue, ['单价', 'unit_price', 'unitPrice'])
                              )}
                            </td>
                            <td>
                              {issue.type === 'error' && issue.column?.includes('货币') ? (
                                <span className={styles.cellError}>{getRawField(issue, ['货币单位', 'currency'])}</span>
                              ) : (
                                getRawField(issue, ['货币单位', 'currency'])
                              )}
                            </td>
                            <td>{getRawField(issue, ['含税标记', 'tax_inclusive', 'taxInclusive'])}</td>
                            <td>
                              {issue.type === 'error' && issue.column?.includes('日期') ? (
                                <span className={styles.cellError}>{getRawField(issue, ['报价日期', 'quote_date', 'quoteDate'])}</span>
                              ) : (
                                getRawField(issue, ['报价日期', 'quote_date', 'quoteDate'])
                              )}
                            </td>
                            <td>{getRawField(issue, ['备注', 'notes', 'remark'])}</td>
                            <td>
                              {issue.type === 'error' ? (
                                <span className={styles.errorReason}>
                                  <span>•</span>
                                  <span>{issue.message}</span>
                                </span>
                              ) : issue.type === 'duplicate' ? (
                                <span className={styles.duplicateReason}>
                                  ⚠ 已有相同报价记录，将追加为新版本
                                </span>
                              ) : isAnomaly ? (
                                <span className={styles.warnReason}>
                                  <span className={styles.anomalyBadge}>⚠ 价格偏高</span>
                                  {issue.importedPrice !== undefined && issue.historicalPrice !== undefined && (
                                    <span style={{ marginLeft: 4 }}>
                                      超历史价 {((issue.importedPrice / issue.historicalPrice)).toFixed(1)} 倍
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span className={styles.warnReason}>
                                  <span>•</span>
                                  <span>{issue.message}</span>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {allIssues.length > 100 && (
                  <div className={styles.previewFoldHint}>
                    <span>⋯</span> 共 {allIssues.length} 条问题行，已显示前 100 条。
                  </div>
                )}
              </div>
            )}

            {/* FE-03-03: 价格异常确认复选框 */}
            {hasAnomalies && handleMode === 'import-valid' && (
              <label className={styles.anomalyConfirmRow}>
                <input
                  type="checkbox"
                  className={styles.anomalyConfirmRow__checkbox}
                  checked={anomalyConfirmed}
                  onChange={(e) => onAnomalyConfirmedChange(e.target.checked)}
                />
                <span className={styles.anomalyConfirmRow__text}>
                  我已确认价格偏高行（共 {anomalyRowNumbers.size} 条），了解导入价格超过历史价格 3 倍以上
                </span>
              </label>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        <div className={styles.footer__left}>
          <Button variant="ghost" onClick={onPrev} disabled={confirming}>
            ← 上一步
          </Button>
        </div>
        <div className={styles.footer__right}>
          {/* FE-03-02: 错误过多时只显示返回按钮 */}
          {tooManyErrors ? (
            <Button variant="danger" onClick={onPrev}>
              重新上传
            </Button>
          ) : handleMode === 'abort-all' ? (
            <Button variant="danger" onClick={onPrev}>
              取消导入，重新上传
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={onConfirm}
              loading={confirming}
              disabled={importDisabled}
              title={hasAnomalies && !anomalyConfirmed ? '请先勾选确认价格偏高行后再导入' : undefined}
            >
              {confirming ? '处理中...' : '下一步：确认导入 →'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 子组件：Step4 导入执行中（G14: 进度条）
// ─────────────────────────────────────────────

interface Step4ImportingProps {
  importingProgress: number;
  importingTotal: number;
  importingDone: number;
  onAbort: () => void;
}

function Step4Importing({
  importingProgress,
  importingTotal,
  importingDone,
  onAbort,
}: Step4ImportingProps) {
  return (
    <div className={styles.body} key="step4-importing">
      <div className={styles.stepCard}>
        <div className={styles.importingBlock}>
          {/* 转圈动画 */}
          <div className={styles.importingSpinner} aria-hidden="true" />
          <div className={styles.importingTitle}>正在写入数据库…</div>
          <div className={styles.importingSubtitle}>
            已写入 {importingDone.toLocaleString()} / {importingTotal.toLocaleString()} 条，请勿关闭页面
          </div>

          {/* 进度条 */}
          <div className={styles.importingProgressWrap}>
            <div className={styles.importingProgressHeader}>
              <span>导入进度</span>
              <span className={styles.importingProgressPct}>{importingProgress}%</span>
            </div>
            <div
              className={styles.progressBar}
              role="progressbar"
              aria-valuenow={importingProgress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className={styles.progressFill} style={{ width: `${importingProgress}%` }} />
            </div>
          </div>

          <div className={styles.importingNote}>
            每 2 秒自动刷新进度 · 预计剩余约 {Math.max(0, Math.ceil(((100 - importingProgress) / 100) * 20))} 秒
          </div>
        </div>
      </div>

      {/* Footer — 终止导入按钮（G14） */}
      <div className={styles.footer}>
        <div className={styles.footer__left}>
          <Button variant="ghost" disabled>
            ← 上一步
          </Button>
        </div>
        <div className={styles.footer__right}>
          <Button variant="danger" size="sm" onClick={onAbort}>
            终止导入
          </Button>
          <Button variant="primary" loading disabled>
            导入中…
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 子组件：Step4 — 导入结果
// ─────────────────────────────────────────────

interface Step4ResultProps {
  result: ImportResult;
  onClose: () => void;
  onReimport: () => void;
}

function Step4Result({ result, onClose, onReimport }: Step4ResultProps) {
  const allSuccess = result.failCount === 0;
  const skipCount = result.skipCount ?? result.errors.length;

  // FE-03-04: 下载失败明细处理
  const handleDownloadFailed = useCallback(() => {
    downloadFailedDetailCSV(result.errors);
  }, [result.errors]);

  return (
    <div className={styles.body} key="step4-result">
      <div className={styles.stepCard}>
        <div className={styles.stepCard__title}>
          <div className={styles.stepCard__icon}>🎉</div>
          导入完成！
        </div>
        <p className={styles.stepCard__desc}>
          {allSuccess
            ? '采购价格数据已成功写入系统，可在价格管理页查看最新数据。'
            : '导入已完成，部分数据写入成功，请核查失败详情。'}
        </p>

        {/* 成功动效 */}
        {allSuccess && (
          <div className={styles.successBlock}>
            <svg className={styles.checkmarkSvg} viewBox="0 0 72 72" aria-hidden="true">
              <circle className={styles.checkmarkCircle} cx="36" cy="36" r="34" />
              <path className={styles.checkmarkPath} d="M22 37 L32 47 L52 26" />
            </svg>
            <div className={styles.successTitle}>导入成功！</div>
            <div className={styles.successDesc}>
              采购价格数据已成功写入系统，可在价格管理页查看最新数据。
            </div>
          </div>
        )}

        {/* G15: 统计卡片 — 增加「跳过错误行」独立卡片 */}
        <div className={styles.resultSummary}>
          <div className={`${styles.resultStatCard} ${styles['resultStatCard--success']}`}>
            <span className={styles.resultStatCard__icon}>✅</span>
            <span className={styles.resultStatCard__num}>{result.successCount.toLocaleString()}</span>
            <span className={styles.resultStatCard__label}>成功导入</span>
          </div>
          {/* G15: 跳过错误行独立卡片 */}
          {skipCount > 0 && (
            <div className={`${styles.resultStatCard} ${styles['resultStatCard--skip']}`}>
              <span className={styles.resultStatCard__icon}>⏭</span>
              <span className={styles.resultStatCard__num}>{skipCount}</span>
              <span className={styles.resultStatCard__label}>跳过错误行</span>
            </div>
          )}
          {result.failCount > 0 && (
            <div className={`${styles.resultStatCard} ${styles['resultStatCard--fail']}`}>
              <span className={styles.resultStatCard__icon}>❌</span>
              <span className={styles.resultStatCard__num}>{result.failCount}</span>
              <span className={styles.resultStatCard__label}>意外失败</span>
            </div>
          )}
        </div>

        {/* 失败行详情 */}
        {result.errors.length > 0 && (
          <>
            {/* FE-03-04: 下载失败明细操作栏 */}
            <div className={styles.failDownloadBar}>
              <div className={styles.failDownloadBar__info}>
                <span className={styles.failDownloadBar__icon}>📄</span>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--color-error-700)' }}>
                    {result.failCount} 条意外失败
                  </div>
                  <div style={{ fontSize: 'var(--text-body-s)', color: 'var(--color-error-600)', marginTop: 'var(--space-1)' }}>
                    数据库写入时发生异常，可下载失败明细后人工核实并重试。
                  </div>
                </div>
              </div>
              <Button
                variant="danger"
                size="sm"
                onClick={handleDownloadFailed}
              >
                ⬇ 下载失败明细
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Footer — G15: 增加「再次导入」按钮 */}
      <div className={styles.footer}>
        <div className={styles.footer__left} />
        <div className={styles.footer__right}>
          {/* G15: 再次导入 */}
          <Button variant="secondary" onClick={onReimport}>
            再次导入
          </Button>
          <Button variant="primary" onClick={onClose}>
            查看导入数据 →
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 主组件：PriceImportWizard
// ─────────────────────────────────────────────

export interface PriceImportWizardProps {
  open: boolean;
  onClose: () => void;
  /** 导入成功后（Step4 关闭时）触发，父组件用于刷新列表 */
  onSuccess: () => void;
}

export default function PriceImportWizard({
  open,
  onClose,
  onSuccess,
}: PriceImportWizardProps) {
  const [step, setStep]             = useState<Step>(1);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading]   = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError]   = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<ImportResult | null>(null);
  const [handleMode, setHandleMode] = useState<HandleMode>('import-valid');
  const [confirming, setConfirming] = useState(false);

  // FE-03-01: 大文件解析进度条状态
  const [showParseProgress, setShowParseProgress] = useState(false);
  const [parseProgress, setParseProgress] = useState(0);

  // FE-03-05: 解析状态反馈
  const [parseState, setParseState] = useState<ParseState>('idle');

  // FE-03-03: 价格异常确认
  const [anomalyConfirmed, setAnomalyConfirmed] = useState(false);

  // G14: 导入执行中进度条
  const [importingPhase, setImportingPhase] = useState<ImportingPhase>('idle');
  const [importingProgress, setImportingProgress] = useState(0);
  const [importingDone, setImportingDone] = useState(0);
  const uploadTickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const importingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRunControllerRef = useRef<AbortController | null>(null);

  const isAbortError = useCallback((error: unknown): boolean =>
    error instanceof DOMException && error.name === 'AbortError', []);

  /** 清理导入进度轮询定时器 */
  const clearUploadTicker = useCallback(() => {
    if (uploadTickerRef.current) {
      clearInterval(uploadTickerRef.current);
      uploadTickerRef.current = null;
    }
  }, []);

  const clearImportingTimer = useCallback(() => {
    if (importingTimerRef.current) {
      clearInterval(importingTimerRef.current);
      importingTimerRef.current = null;
    }
  }, []);

  const abortActiveRun = useCallback(() => {
    activeRunControllerRef.current?.abort();
    activeRunControllerRef.current = null;
  }, []);

  const beginAsyncRun = useCallback(() => {
    abortActiveRun();
    const controller = new AbortController();
    activeRunControllerRef.current = controller;
    return controller;
  }, [abortActiveRun]);

  const sleepWithSignal = useCallback((ms: number, signal: AbortSignal) => (
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const timer = window.setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        window.clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    })
  ), []);

  // 关闭时重置全部状态
  const resetState = useCallback(() => {
    abortActiveRun();
    clearUploadTicker();
    clearImportingTimer();
    setStep(1);
    setSelectedFile(null);
    setUploading(false);
    setUploadProgress(0);
    setUploadError(null);
    setUploadResult(null);
    setHandleMode('import-valid');
    setConfirming(false);
    setShowParseProgress(false);
    setParseProgress(0);
    setParseState('idle');
    setAnomalyConfirmed(false);
    setImportingPhase('idle');
    setImportingProgress(0);
    setImportingDone(0);
  }, [abortActiveRun, clearImportingTimer, clearUploadTicker]);

  // 弹框关闭（非成功关闭）
  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  // Step4 关闭（成功）
  const handleSuccessClose = useCallback(() => {
    resetState();
    onClose();
    onSuccess();
  }, [resetState, onClose, onSuccess]);

  // G15: 再次导入 — 重置到 Step1
  const handleReimport = useCallback(() => {
    resetState();
  }, [resetState]);

  // Step2 → Step3：上传并获取校验结果
  const handleUpload = useCallback(async () => {
    if (!selectedFile) return;
    const runController = beginAsyncRun();
    setUploadError(null);
    setUploading(true);
    setUploadProgress(10);
    setParseProgress(0);

    // FE-03-01: 判断是否为大文件（> 500KB）
    const isLargeFile = selectedFile.size > LARGE_FILE_THRESHOLD;
    setShowParseProgress(isLargeFile);

    // FE-03-05: 进入解析中状态
    setParseState('parsing');

    // 模拟进度（实际上传为同步等待）
    clearUploadTicker();
    uploadTickerRef.current = setInterval(() => {
      if (isLargeFile) {
        setParseProgress((prev) => Math.min(prev + 12, 85));
      }
      setUploadProgress((prev) => Math.min(prev + 15, 85));
    }, 300);

    try {
      const result = await priceApi.importPrices(selectedFile);
      if (runController.signal.aborted) return;
      clearUploadTicker();
      setUploadProgress(100);
      setParseProgress(100);
      setUploadResult(result);

      // 短暂延迟让进度条视觉完成
      await sleepWithSignal(300, runController.signal);
      if (runController.signal.aborted) return;

      // FE-03-05: 根据错误数量切换解析状态
      const errorCount = result.errors.length;
      if (errorCount > TOO_MANY_ERRORS_THRESHOLD) {
        setParseState('error');
      } else if (errorCount > 0 || result.warnings.length > 0) {
        setParseState('warning');
      } else {
        setParseState('success');
      }

      // 短暂展示状态后再推进到 Step3
      await sleepWithSignal(800, runController.signal);
      if (runController.signal.aborted) return;
      setStep(3);
    } catch (e: unknown) {
      clearUploadTicker();
      if (isAbortError(e)) return;
      setUploadProgress(0);
      setParseProgress(0);
      setParseState('idle');
      const msg = e instanceof Error ? e.message : '上传失败，请检查文件格式后重试';
      setUploadError(msg);
    } finally {
      clearUploadTicker();
      if (activeRunControllerRef.current === runController) {
        activeRunControllerRef.current = null;
      }
      if (!runController.signal.aborted) {
        setUploading(false);
      }
    }
  }, [beginAsyncRun, clearUploadTicker, isAbortError, selectedFile, sleepWithSignal]);

  /**
   * Step3 → Step4：确认导入
   *
   * G14: 显示导入进度条，每 2 秒模拟进度更新。
   * 若后端支持异步导入轮询（priceApi.getImportStatus），可在此接入真实进度。
   * 当前实现：POST /api/prices/import 已在上传阶段完成，这里模拟写入进度动效后直接跳结果页。
   */
  const handleConfirmImport = useCallback(async () => {
    if (!uploadResult) return;
    if (handleMode === 'abort-all') {
      setStep(2);
      return;
    }
    const runController = beginAsyncRun();
    setConfirming(true);
    setImportingPhase('running');
    setImportingProgress(0);
    setImportingDone(0);
    setStep(4);

    const total = uploadResult.successCount || 1;

    // G14: 模拟 2 秒间隔轮询进度条（可替换为真实轮询接口）
    importingTimerRef.current = setInterval(() => {
      setImportingProgress((prev) => {
        const next = Math.min(prev + Math.floor(Math.random() * 18) + 8, 95);
        setImportingDone(Math.floor((next / 100) * total));
        return next;
      });
    }, 2000);

    try {
      // 总延迟约 10 秒，模拟完成（若有真实接口可替换）
      await sleepWithSignal(2000, runController.signal);
      if (runController.signal.aborted) return;
      clearImportingTimer();
      setImportingProgress(100);
      setImportingDone(total);
      await sleepWithSignal(600, runController.signal);
      if (runController.signal.aborted) return;
      setImportingPhase('idle');
    } catch (e: unknown) {
      clearImportingTimer();
      if (isAbortError(e)) return;
      const msg = e instanceof Error ? e.message : '导入失败，请稍后重试';
      setUploadError(msg);
      setImportingPhase('idle');
      setStep(3);
    } finally {
      if (activeRunControllerRef.current === runController) {
        activeRunControllerRef.current = null;
      }
      if (!runController.signal.aborted) {
        setConfirming(false);
      }
    }
  }, [beginAsyncRun, clearImportingTimer, handleMode, isAbortError, sleepWithSignal, uploadResult]);

  /** G14: 终止导入 */
  const handleAbortImport = useCallback(() => {
    abortActiveRun();
    clearImportingTimer();
    setImportingPhase('aborted');
    setConfirming(false);
    // 终止后回到 Step3 让用户重新选择
    setStep(3);
  }, [abortActiveRun, clearImportingTimer]);

  // 弹框关闭时同步重置（处理 ESC 关闭）
  useEffect(() => {
    if (!open) resetState();
  }, [open, resetState]);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      abortActiveRun();
      clearUploadTicker();
      clearImportingTimer();
    };
  }, [abortActiveRun, clearImportingTimer, clearUploadTicker]);

  // 判断 Step4 是否处于执行中阶段
  const isImporting = step === 4 && importingPhase === 'running';
  // Step4 是否已完成
  const isImportDone = step === 4 && importingPhase === 'idle';

  return (
    <Modal
      open={open}
      title="批量导入采购价格"
      onClose={handleClose}
      size="xl"
      hideFooter={true}
    >
      <div className={styles.wizard}>
        {/* 步骤条 */}
        <WizardStepper current={step} />

        {/* 步骤内容 */}
        {step === 1 && (
          <Step1Download onNext={() => setStep(2)} />
        )}

        {step === 2 && (
          <Step2Upload
            selectedFile={selectedFile}
            onFileChange={(f) => {
              setSelectedFile(f);
              setUploadError(null);
              setUploadProgress(0);
              setParseProgress(0);
              setParseState('idle');
              setShowParseProgress(false);
            }}
            onPrev={() => setStep(1)}
            onNext={handleUpload}
            uploading={uploading}
            uploadProgress={uploadProgress}
            uploadError={uploadError}
            showParseProgress={showParseProgress}
            parseProgress={parseProgress}
            parseState={parseState}
            parseResult={uploadResult}
          />
        )}

        {step === 3 && uploadResult && (
          <Step3Preview
            result={uploadResult}
            handleMode={handleMode}
            onHandleModeChange={setHandleMode}
            onPrev={() => {
              setStep(2);
              setUploadResult(null);
              setParseState('idle');
              setAnomalyConfirmed(false);
            }}
            onConfirm={handleConfirmImport}
            confirming={confirming}
            anomalyConfirmed={anomalyConfirmed}
            onAnomalyConfirmedChange={setAnomalyConfirmed}
          />
        )}

        {/* G14: 导入执行中进度条 */}
        {step === 4 && isImporting && uploadResult && (
          <Step4Importing
            importingProgress={importingProgress}
            importingTotal={uploadResult.successCount}
            importingDone={importingDone}
            onAbort={handleAbortImport}
          />
        )}

        {/* 导入完成结果页 */}
        {step === 4 && isImportDone && uploadResult && (
          <Step4Result
            result={uploadResult}
            onClose={handleSuccessClose}
            onReimport={handleReimport}
          />
        )}
      </div>
    </Modal>
  );
}
