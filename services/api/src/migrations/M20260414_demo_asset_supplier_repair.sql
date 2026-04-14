SET @target_tenant_id := 1;
SET @target_po_no := 'PO-ACC-20260413A';
SET @fallback_supplier_code := 'SUP-ANLT-A';

UPDATE purchase_orders po
JOIN suppliers sup
  ON sup.tenant_id = po.tenant_id
 AND BINARY sup.code = BINARY @fallback_supplier_code
LEFT JOIN suppliers current_sup
  ON current_sup.id = po.supplier_id
 AND current_sup.tenant_id = po.tenant_id
SET po.supplier_id = sup.id
WHERE po.tenant_id = @target_tenant_id
  AND BINARY po.po_no = BINARY @target_po_no
  AND current_sup.id IS NULL;
