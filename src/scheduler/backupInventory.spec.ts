import { expect, it } from 'vitest'
import { createDefaultWorkspace } from '../workbench/defaults'
import { workspaceUsesInventoryConditions } from './backupInventory'

it('detects inventory queries in expression trees without treating quoted mentions as calls', () => {
  const workspace = createDefaultWorkspace()
  expect(workspaceUsesInventoryConditions(workspace)).toBe(false)
  workspace.compatibility.backupPlans = [{ trigger: { left: "op_data.inventory_count('赤金')", operator: '<', right: 20 } }]
  expect(workspaceUsesInventoryConditions(workspace)).toBe(true)
  workspace.compatibility.backupPlans = [{ trigger: '"op_data.inventory_count()" == "text"' }]
  expect(workspaceUsesInventoryConditions(workspace)).toBe(false)
  workspace.compatibility.backupPlans = [{ trigger: "op_data.facility_product('room_1_1') == lmd" }]
  expect(workspaceUsesInventoryConditions(workspace)).toBe(false)
})
