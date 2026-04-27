import { ProcessConfigService } from '../../src/modules/process-config/processConfig.service';

describe('ProcessConfigService step normalization', () => {
  const service = new ProcessConfigService({ tenantId: 1, userId: 1 }) as any;

  it('allows standard templates to keep final-product output as an unbound placeholder', async () => {
    await expect(service.normalizeSteps([
      {
        stepNo: 1,
        stepName: '截断锯开料',
        outputType: 'final_product',
        outputSkuId: null,
      },
    ], { allowUnboundFinalOutput: true })).resolves.toMatchObject([
      {
        stepNo: 1,
        outputType: 'final_product',
        outputSkuId: null,
      },
    ]);
  });

  it('still requires concrete output SKU for SKU-bound templates', async () => {
    await expect(service.normalizeSteps([
      {
        stepNo: 1,
        stepName: '截断锯开料',
        outputType: 'final_product',
        outputSkuId: null,
      },
    ])).rejects.toThrow('指定了产出类型，但缺少产出 SKU');
  });
});
