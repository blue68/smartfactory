import { useCallback, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { skuApi } from '@/api/sku';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import styles from './SkuPage.module.css';

interface ImportWizardModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (count: number) => void;
}

function parseFileData(buffer: ArrayBuffer, fileName?: string): { headers: string[]; rows: string[][] } {
  const isCsv = fileName ? /\.csv$/i.test(fileName) : false;
  const wb = isCsv
    ? XLSX.read(new TextDecoder('utf-8').decode(buffer), { type: 'string' })
    : XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' });

  if (data.length === 0) return { headers: [], rows: [] };

  const headers = data[0].map((h) => String(h).trim());
  const rows = data
    .slice(1)
    .filter((row) => row.some((cell) => String(cell).trim() !== ''))
    .map((row) => row.map((cell) => String(cell).trim()));

  return { headers, rows };
}

type MappingStatus = 'ok' | 'warn' | 'none';

interface FieldMappingRow {
  excelCol: string;
  sysField: string;
  status: MappingStatus;
}

const SYSTEM_FIELDS = [
  'SKU编码', '物料名称', '规格型号', '规格描述', '一级分类', '二级分类', '二级品类',
  '基本单位', '库存单位', '采购单位', '计价单位', '生产领用单位',
  '库存换算系数', '领用换算说明', '安全库存', '状态', '品牌归属',
  '所属客户编码', '所属客户名称', '客户SKU编码', '客户SKU名称', '备注',
] as const;

const CANONICAL_FIELD_ALIASES: Record<string, string> = {
  SKU编码: 'SKU编码',
  物料名称: '物料名称',
  规格型号: '规格描述',
  规格描述: '规格描述',
  一级分类: '一级分类',
  二级分类: '二级品类',
  二级品类: '二级品类',
  基本单位: '库存单位',
  库存单位: '库存单位',
  采购单位: '采购单位',
  计价单位: '生产领用单位',
  生产领用单位: '生产领用单位',
  库存换算系数: '库存换算系数',
  领用换算说明: '领用换算说明',
  安全库存: '安全库存',
  状态: '状态',
  品牌归属: '品牌归属',
  所属客户编码: '所属客户编码',
  所属客户名称: '所属客户名称',
  客户SKU编码: '客户SKU编码',
  客户SKU名称: '客户SKU名称',
  备注: '备注',
};

const IMPORT_PREVIEW_FIELDS = [
  '物料名称',
  '规格描述',
  '一级分类',
  '二级品类',
  '采购单位',
  '库存单位',
] as const;

function autoMatchField(col: string): { sysField: string; status: MappingStatus } {
  const c = col.toLowerCase();

  for (const f of SYSTEM_FIELDS) {
    if (col === f) return { sysField: CANONICAL_FIELD_ALIASES[f] ?? f, status: 'ok' };
  }

  if (c.includes('所属客户') && c.includes('编码')) return { sysField: '所属客户编码', status: 'warn' };
  if (c.includes('所属客户') && c.includes('名称')) return { sysField: '所属客户名称', status: 'warn' };
  if (c.includes('客户sku') && c.includes('编码')) return { sysField: '客户SKU编码', status: 'warn' };
  if (c.includes('客户sku') && c.includes('名称')) return { sysField: '客户SKU名称', status: 'warn' };
  if (c.includes('物料') && c.includes('编码')) return { sysField: 'SKU编码', status: 'warn' };
  if (c.includes('名称') || c.includes('品名') || c.includes('name')) return { sysField: '物料名称', status: 'warn' };
  if (c.includes('规格') || c.includes('spec')) return { sysField: '规格描述', status: 'warn' };
  if (c.includes('一级') || c.includes('大类')) return { sysField: '一级分类', status: 'warn' };
  if (c.includes('二级') || c.includes('子类') || c.includes('小类')) return { sysField: '二级品类', status: 'warn' };
  if ((c.includes('库存') && c.includes('单位')) || c.includes('uom')) return { sysField: '库存单位', status: 'warn' };
  if (c.includes('采购') && c.includes('单位')) return { sysField: '采购单位', status: 'warn' };
  if (c.includes('生产') && c.includes('单位')) return { sysField: '生产领用单位', status: 'warn' };
  if (c.includes('库存') && c.includes('换算')) return { sysField: '库存换算系数', status: 'warn' };
  if (c.includes('领用') && c.includes('换算')) return { sysField: '领用换算说明', status: 'warn' };
  if (c.includes('安全') || c.includes('safety')) return { sysField: '安全库存', status: 'warn' };
  if (c.includes('品牌')) return { sysField: '品牌归属', status: 'warn' };
  if (c.includes('备注') || c.includes('remark')) return { sysField: '备注', status: 'warn' };

  return { sysField: '', status: 'none' };
}

function buildAutoMapping(headers: string[]): FieldMappingRow[] {
  return headers.map((col) => {
    const { sysField, status } = autoMatchField(col);
    return { excelCol: col, sysField, status };
  });
}

export default function SkuImportWizardModal({ open, onClose, onSuccess }: ImportWizardModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<string[][]>([]);
  const [fieldMapping, setFieldMapping] = useState<FieldMappingRow[]>([]);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [importing, setImporting] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{
    imported: number;
    failed: number;
    errors: Array<{ row: number; message: string }>;
  } | null>(null);

  const handleClose = useCallback(() => {
    setStep(1);
    setSelectedFile(null);
    setParsedHeaders([]);
    setParsedRows([]);
    setFieldMapping([]);
    setParseError(null);
    setImportResult(null);
    setImporting(false);
    setDownloadingTemplate(false);
    onClose();
  }, [onClose]);

  const handleFileChange = useCallback((file: File | null) => {
    if (!file) return;
    if (!file.name.match(/\.(xlsx|xls|csv)$/i)) return;
    setSelectedFile(file);
    setParseError(null);
  }, []);

  const handleNext = useCallback(() => {
    if (step === 1) {
      if (!selectedFile) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const buffer = e.target?.result as ArrayBuffer;
        const { headers, rows } = parseFileData(buffer, selectedFile.name);

        if (headers.length === 0) {
          setParseError('文件内容为空或格式不正确，请检查文件后重试。');
          return;
        }
        if (rows.length === 0) {
          setParseError('文件中没有数据行，请至少包含一行数据。');
          return;
        }

        setParsedHeaders(headers);
        setParsedRows(rows);
        setFieldMapping(buildAutoMapping(headers));
        setParseError(null);
        setStep(2);
      };
      reader.onerror = () => {
        setParseError('文件读取失败，请重新选择文件。');
      };
      reader.readAsArrayBuffer(selectedFile);
      return;
    }

    if (step === 2) {
      setStep(3);
      return;
    }

    if (!selectedFile) return;
    setImporting(true);

    const mappingRecord: Record<string, string> = {};
    for (const row of fieldMapping) {
      if (row.status !== 'none' && row.sysField) {
        mappingRecord[row.excelCol] = row.sysField;
      }
    }

    skuApi
      .importSkus(selectedFile, mappingRecord)
      .then((res) => {
        const result = {
          imported: res.imported,
          failed: res.failed,
          errors: res.errors ?? [],
        };
        setImportResult(result);
        setImporting(false);
        if (result.imported > 0) {
          onSuccess(result.imported);
        }
      })
      .catch(() => {
        setImportResult({ imported: 0, failed: parsedRows.length, errors: [{ row: 0, message: '服务器异常，请稍后重试' }] });
        setImporting(false);
      });
  }, [fieldMapping, onSuccess, parsedRows.length, selectedFile, step]);

  const handleDownloadTemplate = useCallback(async () => {
    try {
      setDownloadingTemplate(true);
      const blob = await skuApi.downloadImportTemplate();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'SKU导入模板.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingTemplate(false);
    }
  }, []);

  const stepLabels = ['下载模板', '字段映射', '确认导入'];
  const warnCount = fieldMapping.filter((m) => m.status === 'warn').length;
  const previewRows = parsedRows.slice(0, 10);

  const matchStatusIcon = (status: MappingStatus) => {
    if (status === 'ok') return <span className={styles.import_match_ok}>✓ 已匹配</span>;
    if (status === 'warn') return <span className={styles.import_match_warn}>⚠ 请确认</span>;
    return <span className={styles.import_match_none}>○ 未映射</span>;
  };

  const colIndex = (sysField: string) => {
    const match = fieldMapping.find((m) => m.sysField === sysField);
    if (!match) return -1;
    return parsedHeaders.indexOf(match.excelCol);
  };

  const getCellValue = (row: string[], sysField: string): string => {
    const idx = colIndex(sysField);
    return idx >= 0 ? (row[idx] ?? '') : '';
  };

  return (
    <Modal
      open={open}
      title="批量导入 SKU"
      onClose={handleClose}
      size="lg"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {importResult ? (
            <Button variant="primary" onClick={handleClose}>关闭</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={handleClose}>取消</Button>
              {step > 1 && !importing && (
                <Button variant="secondary" onClick={() => setStep((current) => (current - 1) as 1 | 2 | 3)}>
                  上一步
                </Button>
              )}
              <Button
                variant="primary"
                onClick={handleNext}
                disabled={(step === 1 && !selectedFile) || importing}
              >
                {importing ? '导入中...' : step === 3 ? '确认导入' : '下一步'}
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className={styles.import_stepper}>
        {stepLabels.map((label, index) => {
          const currentStep = (index + 1) as 1 | 2 | 3;
          const isActive = step === currentStep;
          const isDone = step > currentStep;
          return (
            <div key={currentStep} className={styles.import_step}>
              <div className={`${styles.import_step_circle} ${isDone ? styles['import_step_circle--done'] : isActive ? styles['import_step_circle--active'] : ''}`}>
                {isDone ? '✓' : currentStep}
              </div>
              <span className={`${styles.import_step_label} ${isActive ? styles['import_step_label--active'] : ''}`}>
                {label}
              </span>
              {index < stepLabels.length - 1 && (
                <div className={`${styles.import_step_line} ${isDone ? styles['import_step_line--done'] : ''}`} />
              )}
            </div>
          );
        })}
      </div>

      {step === 1 && (
        <div className={styles.import_step1}>
          <button
            className={styles.import_download_btn}
            type="button"
            onClick={() => void handleDownloadTemplate()}
          >
            <span>⬇</span>
            <span>{downloadingTemplate ? '模板下载中...' : '下载 Excel 导入模板'}</span>
          </button>

          <div className={styles.import_upload_sub}>
            模板已对齐最新 SKU 新增页通用字段；系统编码、业务大类和控制规则会自动生成，无需在导入文件中填写。
          </div>

          <div
            className={`${styles.import_upload_area} ${isDragOver ? styles['import_upload_area--dragover'] : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file) handleFileChange(file);
            }}
          >
            <div className={styles.import_upload_icon}>📂</div>
            <div className={styles.import_upload_text}>
              <strong>点击选择文件</strong> 或拖拽到此处上传
            </div>
            <div className={styles.import_upload_sub}>支持 .xlsx / .xls / .csv 格式，最大 10MB</div>
            <input
              ref={fileInputRef}
              type="file"
              className={styles.import_upload_input}
              accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                handleFileChange(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
          </div>

          {selectedFile && (
            <div className={styles.import_file_selected}>
              <span>✓</span>
              <span>已选择：{selectedFile.name}（{(selectedFile.size / 1024).toFixed(1)} KB）</span>
            </div>
          )}

          {parseError && (
            <div style={{ marginTop: 8, color: '#ef4444', fontSize: 13 }}>⚠ {parseError}</div>
          )}
        </div>
      )}

      {step === 2 && (
        <div className={styles.import_step2}>
          <div className={styles.import_mapping_title}>
            已自动识别您的文件字段，请确认映射关系：
          </div>
          <table className={styles.import_mapping_table}>
            <thead>
              <tr>
                <th>您的Excel列名</th>
                <th>系统字段</th>
                <th>匹配状态</th>
              </tr>
            </thead>
            <tbody>
              {fieldMapping.map((row, index) => (
                <tr key={index}>
                  <td>{row.excelCol}</td>
                  <td>{row.sysField || <span style={{ color: '#9ca3af' }}>— 未匹配 —</span>}</td>
                  <td>{matchStatusIcon(row.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.import_summary_bar}>
            <span>共检测到 <strong>{parsedRows.length}</strong> 行数据</span>
            {warnCount === 0 ? (
              <span className={styles.import_summary_ok}>✓ 全部精确匹配</span>
            ) : (
              <span className={styles.import_summary_warn}>⚠ {warnCount} 列为模糊匹配，请确认</span>
            )}
            <button className={styles.import_preview_link} type="button" onClick={() => setStep(3)}>
              查看详细预览 →
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className={styles.import_step3}>
          {importResult ? (
            <div>
              <div className={styles.import_confirm_summary} style={{ marginBottom: 16 }}>
                导入完成：成功 <strong style={{ color: '#16a34a' }}>{importResult.imported}</strong> 条，
                失败 <strong style={{ color: importResult.failed > 0 ? '#ef4444' : 'inherit' }}>{importResult.failed}</strong> 条
              </div>
              {importResult.errors.length > 0 && (
                <table className={styles.import_preview_table}>
                  <thead>
                    <tr>
                      <th>行号</th>
                      <th>错误信息</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importResult.errors.map((err, index) => (
                      <tr key={index}>
                        <td style={{ fontFamily: 'monospace' }}>{err.row === 0 ? '—' : err.row}</td>
                        <td style={{ color: '#ef4444' }}>{err.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            <>
              <div className={styles.import_confirm_summary}>
                即将导入 <strong>{parsedRows.length}</strong> 条 SKU 数据
                {previewRows.length < parsedRows.length && `（预览前 ${previewRows.length} 条）`}
                ，请确认无误后点击「确认导入」。
              </div>
              {importing && (
                <div style={{ textAlign: 'center', padding: '24px 0', color: '#6b7280', fontSize: 14 }}>
                  <div style={{ marginBottom: 8 }}>正在导入，请稍候...</div>
                </div>
              )}
              {!importing && (
                <table className={styles.import_preview_table}>
                  <thead>
                    <tr>
                      {IMPORT_PREVIEW_FIELDS.map((field) => (
                        <th key={field}>{field}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, index) => (
                      <tr key={index}>
                        {IMPORT_PREVIEW_FIELDS.map((field) => (
                          <td key={`${field}-${index}`}>{getCellValue(row, field)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
