/**
 * [artifact:前端代码] — 采购价格批量导入向导
 * R-03 Sprint 1
 *
 * 功能：
 *   - Step1：下载模板（含列说明规格表）
 *   - Step2：拖拽/点击上传 .xlsx/.xls 文件
 *             FE-03-01: 大文件（>500KB）解析时显示进度条
 *             FE-03-05: 4 种解析状态反馈（解析中/成功/警告/错误过多）
 *   - Step3：预览校验结果（错误行红色 / 警告行黄色）+ 处理方式单选
 *             FE-03-02: 错误 > 50 条时显示错误过多状态，隐藏明细表
 *             FE-03-03: 价格异常行黄色高亮 + 确认异常复选框
 *   - Step4：导入结果展示（成功数 / 失败数）
 *             FE-03-04: 失败行时显示"下载失败明细"按钮
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

/** 大文件阈值：500KB */
const LARGE_FILE_THRESHOLD = 512000;

/** 错误过多阈值 */
const TOO_MANY_ERRORS_THRESHOLD = 50;

/** 价格异常偏差阈值：30% */
const PRICE_ANOMALY_THRESHOLD = 0.3;

const STEP_LABELS = ['下载模板', '上传文件', '预览校验', '导入结果'];
const ACCEPTED_EXTS = ['.xlsx', '.xls'];
const MAX_FILE_SIZE_MB = 10;

/** 模板列说明 */
const TEMPLATE_COLUMNS = [
  { col: 'A', name: '供应商编码', required: true,  note: '系统已注册的供应商编码' },
  { col: 'B', name: '物料编码',   required: true,  note: '系统已注册的 SKU 编码' },
  { col: 'C', name: '含税单价',   required: true,  note: '数字，精度 2 位小数，单位：元' },
  { col: 'D', name: '采购单位',   required: true,  note: '如：个、米、kg、套' },
  { col: 'E', name: '最小起订量', required: false, note: '整数，留空视为 1' },
  { col: 'F', name: '有效期开始', required: true,  note: '格式 YYYY-MM-DD' },
  { col: 'G', name: '有效期截止', required: false, note: '格式 YYYY-MM-DD，留空为长期有效' },
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
function downloadFailedDetailCSV(errors: ImportRowIssue[]): void {
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
  const filename = `价格导入失败明细_${datePart}_${timePart}.csv`;

  // 构建 CSV 内容
  const headers = ['行号', '错误列', '错误原因', '导入单价', '历史参考价'];
  const rows = errors.map((err) => [
    `第 ${err.row} 行`,
    err.column ?? '',
    err.message,
    err.importedPrice !== undefined ? String(err.importedPrice) : '',
    err.historicalPrice !== undefined ? String(err.historicalPrice) : '',
  ]);

  // 如果有 rawData 字段，追加原始列
  const hasRawData = errors.some((e) => e.rawData && Object.keys(e.rawData).length > 0);
  if (hasRawData) {
    const rawKeys = Array.from(
      new Set(errors.flatMap((e) => (e.rawData ? Object.keys(e.rawData) : [])))
    );
    headers.push(...rawKeys);
    rows.forEach((row, i) => {
      rawKeys.forEach((key) => {
        const val = errors[i].rawData?.[key];
        row.push(val !== undefined && val !== null ? String(val) : '');
      });
    });
  }

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
  a.download = filename;
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
          请下载官方提供的 Excel 模板，按照格式填写价格数据后再上传。模板中已包含示例行和格式说明。
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
              {downloading ? '⏳' : '📥'}
            </span>
            <span className={styles.templateFileCard__name}>
              {downloading ? '下载中...' : '采购价格导入模板.xlsx'}
            </span>
            <span className={styles.templateFileCard__hint}>
              {downloading ? '请稍候' : '点击下载 Excel 模板'}
            </span>
          </button>

          {/* 列说明规格表 */}
          <div className={styles.specWrap}>
            <div className={styles.specTitle}>
              <span>📌</span> 模板列说明（共 7 列）
            </div>
            <table className={styles.specTable}>
              <thead>
                <tr>
                  <th>列</th>
                  <th>字段名</th>
                  <th>必填</th>
                  <th>说明</th>
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
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        <div className={styles.footer__left} />
        <div className={styles.footer__right}>
          <Button variant="primary" onClick={onNext}>
            下一步 →
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
      return (
        <div className={`${styles.parseStatus} ${styles['parseStatus--success']}`}>
          <span className={styles.parseStatus__icon}>✅</span>
          <span className={styles.parseStatus__text}>
            文件解析完成，共 <strong>{parseResult.successCount}</strong> 条有效记录
          </span>
        </div>
      );
    }

    if (parseState === 'warning' && parseResult) {
      const errorCount = parseResult.errors.length + parseResult.warnings.length;
      return (
        <div className={`${styles.parseStatus} ${styles['parseStatus--warning']}`}>
          <span className={styles.parseStatus__icon}>⚠️</span>
          <span className={styles.parseStatus__text}>
            发现 <strong>{errorCount}</strong> 条问题，请检查后继续
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
          <div className={styles.stepCard__icon}>📂</div>
          第二步：上传 Excel 文件
        </div>
        <p className={styles.stepCard__desc}>
          将填写好的 Excel 文件拖拽到下方区域，或点击选择文件。仅支持 .xlsx / .xls 格式，文件大小不超过 {MAX_FILE_SIZE_MB}MB。
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
            <span className={styles.uploadZone__icon}>📤</span>
            <span className={styles.uploadZone__title}>
              {isDragging ? '松开即可上传' : '拖拽文件到此处'}
            </span>
            <span className={styles.uploadZone__subtitle}>或点击此区域选择文件</span>
            <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
              选择文件
            </Button>
            <span className={styles.uploadZone__note}>支持 .xlsx / .xls，最大 {MAX_FILE_SIZE_MB}MB</span>
          </div>
        ) : (
          <div className={styles.fileCard}>
            <span className={styles.fileCard__icon}>📗</span>
            <div className={styles.fileCard__info}>
              <div className={styles.fileCard__name}>{selectedFile.name}</div>
              <div className={styles.fileCard__meta}>
                {formatFileSize(selectedFile.size)} · {selectedFile.name.split('.').pop()?.toUpperCase()} 文件
              </div>
            </div>
            <button
              type="button"
              className={styles.fileCard__removebtn}
              onClick={() => onFileChange(null)}
              aria-label="移除文件"
              disabled={uploading}
            >
              ×
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
            <span>📎</span> 格式：.xlsx / .xls
          </div>
          <div className={styles.uploadLimitItem}>
            <span>📦</span> 最大：{MAX_FILE_SIZE_MB}MB
          </div>
          <div className={styles.uploadLimitItem}>
            <span>📊</span> 单次最多 5,000 行
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
            {uploading ? '校验中...' : '下一步 →'}
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
  const totalRows = result.successCount + result.failCount;
  const hasErrors   = result.errors.length > 0;
  const hasWarnings = result.warnings.length > 0;

  // FE-03-02: 检测错误过多状态
  const tooManyErrors = result.errors.length > TOO_MANY_ERRORS_THRESHOLD;

  // FE-03-03: 从 result.anomalies 或 result.warnings 中检测价格异常行
  // 后端可在 anomalies 字段标记，或在 warnings 中包含 historicalPrice/importedPrice
  const anomalyRows: ImportRowIssue[] = [
    ...(result.anomalies ?? []),
    ...result.warnings.filter(isAnomalyRow),
  ];
  // 去重（按行号）
  const anomalyRowNumbers = new Set(anomalyRows.map((r) => r.row));
  const hasAnomalies = anomalyRowNumbers.size > 0;

  // 合并错误和警告，按行号排序用于表格展示
  type IssueRow = ImportRowIssue & { type: 'error' | 'warning' };
  const allIssues: IssueRow[] = [
    ...result.errors.map((e) => ({ ...e, type: 'error' as const })),
    ...result.warnings.map((w) => ({ ...w, type: 'warning' as const })),
  ].sort((a, b) => a.row - b.row);

  // FE-03-03: 是否禁用导入按钮（有异常行且未确认时禁用）
  const importDisabled =
    confirming ||
    (handleMode === 'import-valid' && result.successCount === 0) ||
    (hasAnomalies && !anomalyConfirmed);

  return (
    <div className={styles.body} key="step3">
      <div className={styles.stepCard}>
        <div className={styles.stepCard__title}>
          <div className={styles.stepCard__icon}>🔍</div>
          第三步：预览校验结果
        </div>
        <p className={styles.stepCard__desc}>
          系统已完成数据校验，请确认以下结果，选择处理方式后点击「确认导入」。
        </p>

        {/* 统计 chips */}
        <div className={styles.previewStats}>
          <div className={`${styles.statChip} ${styles['statChip--total']}`}>
            <span>📋</span>
            <span>共</span>
            <span className={styles.statChip__num}>{totalRows}</span>
            <span>行</span>
          </div>
          <div className={`${styles.statChip} ${styles['statChip--success']}`}>
            <span>✅</span>
            <span>合法</span>
            <span className={styles.statChip__num}>{result.successCount}</span>
            <span>行</span>
          </div>
          {hasErrors && (
            <div className={`${styles.statChip} ${styles['statChip--error']}`}>
              <span>❌</span>
              <span>错误</span>
              <span className={styles.statChip__num}>{result.failCount}</span>
              <span>行</span>
            </div>
          )}
          {hasWarnings && (
            <div className={`${styles.statChip} ${styles['statChip--warning']}`}>
              <span>⚠️</span>
              <span>价格预警</span>
              <span className={styles.statChip__num}>{result.warnings.length}</span>
              <span>行</span>
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
                    <div className={styles.handleOption__label}>仅导入合法行</div>
                    <div className={styles.handleOption__desc}>
                      跳过错误行，将 {result.successCount} 条合法数据写入系统
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
                    <div className={styles.handleOption__label}>全部放弃</div>
                    <div className={styles.handleOption__desc}>
                      放弃本次导入，返回修正后重新上传
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

            {/* 问题行表格 */}
            {allIssues.length > 0 && (
              <div className={styles.previewTableWrap} style={{ marginTop: 'var(--space-4)' }}>
                <div className={styles.previewTableHeader}>
                  <span>问题行详情（错误行 {result.errors.length} 条 / 价格预警 {result.warnings.length} 条）</span>
                </div>
                <div className={styles.previewScroll}>
                  <table className={styles.previewTable}>
                    <thead>
                      <tr>
                        <th>类型</th>
                        <th>行号</th>
                        <th>列</th>
                        <th>问题描述</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allIssues.map((issue, i) => {
                        // FE-03-03: 价格异常行使用 anomalyRow 样式
                        const isAnomaly = issue.type === 'warning' && anomalyRowNumbers.has(issue.row);
                        const rowClass = issue.type === 'error'
                          ? styles['row--error']
                          : isAnomaly
                          ? styles.anomalyRow
                          : styles['row--warning'];

                        return (
                          <tr key={i} className={rowClass}>
                            <td>
                              {issue.type === 'error' ? (
                                <span style={{ color: 'var(--color-error-600)', fontWeight: 600 }}>❌ 错误</span>
                              ) : isAnomaly ? (
                                <span className={styles.anomalyBadge}>⚠ 价格异常</span>
                              ) : (
                                <span style={{ color: 'var(--color-warning-600)', fontWeight: 600 }}>⚠️ 预警</span>
                              )}
                            </td>
                            <td>第 {issue.row} 行</td>
                            <td>{issue.column ?? '—'}</td>
                            <td>
                              {issue.type === 'error' ? (
                                <span className={styles.errorReason}>
                                  <span>•</span>
                                  <span>{issue.message}</span>
                                </span>
                              ) : (
                                <span className={styles.warnReason}>
                                  <span>•</span>
                                  <span>{issue.message}</span>
                                  {isAnomaly && issue.importedPrice !== undefined && issue.historicalPrice !== undefined && (
                                    <span style={{ color: 'var(--color-warning-600)', marginLeft: 4 }}>
                                      （导入价 {issue.importedPrice} / 历史价 {issue.historicalPrice}）
                                    </span>
                                  )}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
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
                  我已确认价格异常行（共 {anomalyRowNumbers.size} 条），了解导入价格与历史价格偏差超过 30%
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
              全部放弃，重新上传
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={onConfirm}
              loading={confirming}
              disabled={importDisabled}
              title={hasAnomalies && !anomalyConfirmed ? '请先勾选确认异常价格后再导入' : undefined}
            >
              {confirming ? '导入中...' : '确认导入'}
            </Button>
          )}
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
}

function Step4Result({ result, onClose }: Step4ResultProps) {
  const allSuccess = result.failCount === 0;

  // FE-03-04: 下载失败明细处理
  const handleDownloadFailed = useCallback(() => {
    downloadFailedDetailCSV(result.errors);
  }, [result.errors]);

  return (
    <div className={styles.body} key="step4">
      <div className={styles.stepCard}>
        <div className={styles.stepCard__title}>
          <div className={styles.stepCard__icon}>🎉</div>
          第四步：导入结果
        </div>
        <p className={styles.stepCard__desc}>
          {allSuccess
            ? '导入已完成，全部数据写入成功。'
            : '导入已完成，部分数据写入成功，请核查失败详情。'}
        </p>

        {/* 成功动效 */}
        {allSuccess && (
          <div className={styles.successBlock}>
            <svg className={styles.checkmarkSvg} viewBox="0 0 72 72" aria-hidden="true">
              <circle className={styles.checkmarkCircle} cx="36" cy="36" r="34" />
              <path className={styles.checkmarkPath} d="M20 36 l12 12 l20-24" />
            </svg>
            <div className={styles.successTitle}>导入成功！</div>
            <div className={styles.successDesc}>
              价格数据已更新，刷新列表即可查看最新数据。
            </div>
          </div>
        )}

        {/* 统计卡片 */}
        <div className={styles.resultSummary}>
          <div className={`${styles.resultStatCard} ${styles['resultStatCard--success']}`}>
            <span className={styles.resultStatCard__icon}>✅</span>
            <span className={styles.resultStatCard__num}>{result.successCount}</span>
            <span className={styles.resultStatCard__label}>成功导入</span>
          </div>
          {result.failCount > 0 && (
            <div className={`${styles.resultStatCard} ${styles['resultStatCard--fail']}`}>
              <span className={styles.resultStatCard__icon}>❌</span>
              <span className={styles.resultStatCard__num}>{result.failCount}</span>
              <span className={styles.resultStatCard__label}>导入失败</span>
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
                <span>
                  共 <strong>{result.errors.length}</strong> 条记录导入失败，可下载明细文件逐行排查
                </span>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleDownloadFailed}
              >
                ↓ 下载失败明细
              </Button>
            </div>

            <div className={styles.previewTableWrap} style={{ marginTop: 'var(--space-4)' }}>
              <div className={styles.previewTableHeader}>
                <span>失败详情（{result.errors.length} 条）</span>
              </div>
              <div className={styles.previewScroll}>
                <table className={styles.previewTable}>
                  <thead>
                    <tr>
                      <th>行号</th>
                      <th>列</th>
                      <th>失败原因</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.map((err, i) => (
                      <tr key={i} className={styles['row--error']}>
                        <td>第 {err.row} 行</td>
                        <td>{err.column ?? '—'}</td>
                        <td>
                          <span className={styles.errorReason}>
                            <span>•</span>
                            <span>{err.message}</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        <div className={styles.footer__left} />
        <div className={styles.footer__right}>
          <Button variant="primary" onClick={onClose}>
            关闭并刷新列表
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

  // 关闭时重置全部状态
  const resetState = useCallback(() => {
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
  }, []);

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

  // Step2 → Step3：上传并获取校验结果
  const handleUpload = useCallback(async () => {
    if (!selectedFile) return;
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
    const ticker = setInterval(() => {
      if (isLargeFile) {
        setParseProgress((prev) => Math.min(prev + 12, 85));
      }
      setUploadProgress((prev) => Math.min(prev + 15, 85));
    }, 300);

    try {
      const result = await priceApi.importPrices(selectedFile);
      clearInterval(ticker);
      setUploadProgress(100);
      setParseProgress(100);
      setUploadResult(result);

      // 短暂延迟让进度条视觉完成
      await new Promise((r) => setTimeout(r, 300));

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
      await new Promise((r) => setTimeout(r, 800));
      setStep(3);
    } catch (e: unknown) {
      clearInterval(ticker);
      setUploadProgress(0);
      setParseProgress(0);
      setParseState('idle');
      const msg = e instanceof Error ? e.message : '上传失败，请检查文件格式后重试';
      setUploadError(msg);
    } finally {
      setUploading(false);
    }
  }, [selectedFile]);

  // Step3 → Step4：确认导入（仅合法行）
  // 说明：当用户选择「仅导入合法行」时，后端已在 POST /import 时完成合法行写入。
  // 此处不再二次发起写入请求，直接推进至 Step4 展示结果。
  const handleConfirmImport = useCallback(async () => {
    if (!uploadResult) return;
    if (handleMode === 'abort-all') {
      setStep(2);
      return;
    }
    setConfirming(true);
    try {
      // 当前 API 设计：POST /api/prices/import 已原子完成合法行导入
      // successCount / failCount 即为最终结果，直接进入 Step4
      await new Promise((r) => setTimeout(r, 400)); // 模拟确认延迟
      setStep(4);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '导入失败，请稍后重试';
      setUploadError(msg);
    } finally {
      setConfirming(false);
    }
  }, [uploadResult, handleMode]);

  // 弹框关闭时同步重置（处理 ESC 关闭）
  useEffect(() => {
    if (!open) resetState();
  }, [open, resetState]);

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

        {step === 4 && uploadResult && (
          <Step4Result
            result={uploadResult}
            onClose={handleSuccessClose}
          />
        )}
      </div>
    </Modal>
  );
}
