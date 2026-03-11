/**
 * [artifact:前端代码] — 多单位选择器（含换算提示）
 * 对应设计规范 4.2 多单位选择器
 */

import { useState, useEffect } from 'react';
import { buildConversionHint, getAvailableUnits } from '@/utils/unitConverter';
import type { UnitConversion } from '@/types/models';
import styles from './UnitSelector.module.css';

interface UnitSelectorProps {
  value: string;
  unit: string;
  stockUnit: string;
  purchaseUnit?: string;
  productionUnit?: string;
  conversions: UnitConversion[];
  onChange: (value: string, unit: string) => void;
  disabled?: boolean;
  label?: string;
  required?: boolean;
  id?: string;
}

export default function UnitSelector({
  value,
  unit,
  stockUnit,
  purchaseUnit = stockUnit,
  productionUnit = stockUnit,
  conversions,
  onChange,
  disabled = false,
  label = '数量',
  required = false,
  id = 'unit-selector',
}: UnitSelectorProps) {
  const [hint, setHint] = useState<string | null>(null);

  const availableUnits = getAvailableUnits(stockUnit, purchaseUnit, productionUnit, conversions);

  useEffect(() => {
    const h = buildConversionHint(value, unit, stockUnit, conversions);
    setHint(h);
  }, [value, unit, stockUnit, conversions]);

  return (
    <div className={styles.unit_selector}>
      {label && (
        <label htmlFor={id} className={styles.unit_selector__label}>
          {label}
          {required && <span className={styles.unit_selector__required} aria-label="必填"> *</span>}
        </label>
      )}

      <div className={styles.unit_selector__row}>
        {/* 数量输入 */}
        <input
          id={id}
          type="number"
          className={styles.unit_selector__input}
          value={value}
          min="0"
          step="0.0001"
          disabled={disabled}
          onChange={(e) => onChange(e.target.value, unit)}
          aria-describedby={hint ? `${id}-hint` : undefined}
          placeholder="0"
        />

        {/* 单位选择 */}
        <select
          className={styles.unit_selector__select}
          value={unit}
          disabled={disabled || availableUnits.length <= 1}
          onChange={(e) => onChange(value, e.target.value)}
          aria-label="选择单位"
        >
          {availableUnits.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </div>

      {/* 换算提示 */}
      {hint && (
        <div
          id={`${id}-hint`}
          className={styles.unit_selector__hint}
          role="status"
          aria-live="polite"
        >
          <span aria-hidden="true">⇄</span> {hint}
        </div>
      )}
    </div>
  );
}
