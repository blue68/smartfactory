SET @target_tenant_id := 1;
SET @target_receipt_no := 'RC-ACC-20260413A';
SET @broken_unit := 'å°';
SET @fixed_unit := '台';

UPDATE purchase_receipt_items pri
JOIN purchase_receipts pr
  ON pr.id = pri.receipt_id
 AND pr.tenant_id = pri.tenant_id
SET pri.purchase_unit = @fixed_unit
WHERE pri.tenant_id = @target_tenant_id
  AND BINARY pr.receipt_no = BINARY @target_receipt_no
  AND BINARY pri.purchase_unit = BINARY @broken_unit;
