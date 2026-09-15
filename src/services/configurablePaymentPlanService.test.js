import assert from 'node:assert/strict'
import test from 'node:test'

import { createContractRevenueService } from './contractRevenueService.js'

test('savePaymentPlanSet uses one atomic RPC with the exact production parameter names', async () => {
  const calls = []
  const rpc = async (name, args) => {
    calls.push([name, args])
    return [{ ...args.p_plans[0], statusCode: 'active' }]
  }
  const service = createContractRevenueService({ rpc })
  const plans = [{ planId: 'plan-1', projectId: 'P1', installmentOrder: 1 }]

  const result = await service.savePaymentPlanSet('P1', plans)

  assert.deepEqual(calls, [[
    'replace_project_payment_plan_secure',
    { p_project_id: 'P1', p_plans: plans },
  ]])
  assert.equal(result[0].planId, 'plan-1')
})

test('savePaymentPlanSet rejects partial or malformed responses', async () => {
  const service = createContractRevenueService({ rpc: async () => ({ saved: 1 }) })
  await assert.rejects(() => service.savePaymentPlanSet('P1', []), /收款计划保存结果无效/)
})
