import {promoteMowerAlphaWorkspace} from './migrate'
import {resolveOperatorCharId, restoreOperatorMowerName} from '../domain/operatorIdentifiers'
import { defineStore } from 'pinia'
import { computed, ref, toRaw } from 'vue'
import { createDefaultWorkspace } from './defaults'
import { inferFacilityLevels } from './levelInference'
import { normalizeMissingFacilities } from './facilityState'
import { promotePreservedRecycleRoom } from './compat/mowerJson'
import {
  MOWER_OUTPUT_ROOM_IDS,
  MOWER_OPERATOR_LIST_FIELDS,
  type MowerFacility,
  type MowerMainConf,
  type MowerOccupant,
  type MowerOutputRoomId,
  type MowerRoomId,
  type MowerSlot,
  type RosterWorkspace,
} from '../domain/roster'

export type MowerFacilityPatch = Partial<Omit<MowerFacility, 'roomId'>>

export const useRosterWorkbenchStore = defineStore('rosterWorkbench', () => {
  const workspace = ref<RosterWorkspace>(createDefaultWorkspace())
  const selectedRoomId = ref<MowerRoomId | null>('room_1_1')

  const selectedRoom = computed<MowerFacility | null>(() => {
    if (!selectedRoomId.value) return null
    return workspace.value.mainPlan.facilities[selectedRoomId.value] ?? null
  })

  function loadWorkspace(candidate: RosterWorkspace): void {
    const loaded = structuredClone(toRaw(candidate))
    normalizeMissingFacilities(loaded)
    promotePreservedRecycleRoom(loaded)
    promoteMowerAlphaWorkspace(loaded)
    workspace.value = loaded
  }

  function selectRoom(roomId: MowerRoomId | null): void {
    selectedRoomId.value = roomId
  }

  function markRoomPresent(roomId: MowerRoomId): void {
    const list = workspace.value.compatibility.importedPresentRooms
    if (Array.isArray(list) && !list.includes(roomId)) {
      list.push(roomId)
    }
  }

  function swapOutputRooms(sourceId: MowerOutputRoomId, targetId: MowerOutputRoomId): void {
    if (sourceId === targetId) return
    if (!MOWER_OUTPUT_ROOM_IDS.includes(sourceId) || !MOWER_OUTPUT_ROOM_IDS.includes(targetId)) return

    const facilities = workspace.value.mainPlan.facilities
    const source = facilities[sourceId]
    const target = facilities[targetId]
    if (!source || !target) return

    const tempType = source.type
    const tempLevel = source.level
    const tempProduct = source.product
    const tempSlots = structuredClone(toRaw(source.slots))

    source.type = target.type
    source.level = target.level
    source.product = target.product
    source.slots = structuredClone(toRaw(target.slots))

    target.type = tempType
    target.level = tempLevel
    target.product = tempProduct
    target.slots = tempSlots

    markRoomPresent(sourceId)
    markRoomPresent(targetId)
  }

  function updateFacility(roomId: MowerRoomId, patch: MowerFacilityPatch): void {
    const facility = workspace.value.mainPlan.facilities[roomId]
    if (!facility) return

    const rawPatch = toRaw(patch) as Record<string, unknown>
    const { roomId: _ignored, ...safePatch } = rawPatch
    Object.assign(facility, structuredClone(safePatch))
    facility.roomId = roomId

    if (workspace.value.compatibility.facilityMetadata?.[roomId]) {
      if (Object.prototype.hasOwnProperty.call(rawPatch, 'product')) {
        delete workspace.value.compatibility.facilityMetadata[roomId].rawProduct
      }
      if (Object.prototype.hasOwnProperty.call(rawPatch, 'type')) {
        delete workspace.value.compatibility.facilityMetadata[roomId].rawName
      }
    }

    markRoomPresent(roomId)

    if (
      Object.prototype.hasOwnProperty.call(rawPatch, 'type') &&
      !Object.prototype.hasOwnProperty.call(rawPatch, 'level')
    ) {
      inferFacilityLevels(workspace.value.mainPlan.facilities)
    }
  }

  function updateSlot(roomId: MowerRoomId, slotIndex: number, slot: MowerSlot): void {
    const facility = workspace.value.mainPlan.facilities[roomId]
    if (!facility || !facility.slots[slotIndex]) return
    facility.slots[slotIndex] = structuredClone(toRaw(slot))
    markRoomPresent(roomId)
  }

  function updateSlotOccupant(roomId: MowerRoomId, slotIndex: number, occupant: MowerOccupant): void {
    const facility = workspace.value.mainPlan.facilities[roomId]
    if (!facility || !facility.slots[slotIndex]) return
    const slot = facility.slots[slotIndex]
    slot.occupant = structuredClone(toRaw(occupant))
    delete slot.dormitoryResident
    if (occupant.kind !== 'operator') {
      slot.groupId = null
      slot.replacements = []
      delete slot.groupBindings
    }
    markRoomPresent(roomId)
  }

  function updateSlotGroup(roomId: MowerRoomId, slotIndex: number, groupId: string | null): void {
    const facility = workspace.value.mainPlan.facilities[roomId]
    if (!facility || !facility.slots[slotIndex]) return
    facility.slots[slotIndex].groupId = groupId
    markRoomPresent(roomId)
  }

  function setReplacements(roomId: MowerRoomId, slotIndex: number, replacements: string[]): void {
    const facility = workspace.value.mainPlan.facilities[roomId]
    if (!facility || !facility.slots[slotIndex]) return
    facility.slots[slotIndex].replacements = structuredClone(toRaw(replacements))
    markRoomPresent(roomId)
  }

  function addReplacement(roomId: MowerRoomId, slotIndex: number, operatorId: string): void {
    const facility = workspace.value.mainPlan.facilities[roomId]
    if (!facility || !facility.slots[slotIndex] || !operatorId) return
    facility.slots[slotIndex].replacements.push(operatorId)
    markRoomPresent(roomId)
  }

  function removeReplacement(roomId: MowerRoomId, slotIndex: number, replacementIndex: number): void {
    const facility = workspace.value.mainPlan.facilities[roomId]
    if (!facility || !facility.slots[slotIndex]) return
    const reps = facility.slots[slotIndex].replacements
    if (replacementIndex >= 0 && replacementIndex < reps.length) {
      reps.splice(replacementIndex, 1)
      markRoomPresent(roomId)
    }
  }

  function reorderReplacements(
    roomId: MowerRoomId,
    slotIndex: number,
    fromIndex: number,
    toIndex: number,
  ): void {
    const facility = workspace.value.mainPlan.facilities[roomId]
    if (!facility || !facility.slots[slotIndex]) return
    const reps = facility.slots[slotIndex].replacements
    if (fromIndex < 0 || fromIndex >= reps.length || toIndex < 0 || toIndex >= reps.length) return
    const [item] = reps.splice(fromIndex, 1)
    if (item !== undefined) {
      reps.splice(toIndex, 0, item)
      markRoomPresent(roomId)
    }
  }

  function replaceOperatorGlobally(targetOpId: string, replacementOpId: string): void {
    if (!targetOpId || !replacementOpId || targetOpId === replacementOpId) return
    const facilities = workspace.value.mainPlan.facilities

    for (const roomId of Object.keys(facilities) as MowerRoomId[]) {
      const facility = facilities[roomId]
      let modified = false
      for (const slot of facility.slots) {
        if (slot.occupant.kind === 'operator' && slot.occupant.operatorId === targetOpId) {
          slot.occupant.operatorId = replacementOpId
          modified = true
        }
        for (const binding of [slot, ...(slot.groupBindings ?? [])]) {
          if (binding.replacements.includes(targetOpId)) {
            binding.replacements = binding.replacements.map(id => id === targetOpId ? replacementOpId : id)
            modified = true
          }
        }
      }
      if (modified) {
        markRoomPresent(roomId)
      }
    }

    const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
    const replace = (value: unknown): unknown => {
      if (typeof value !== 'string') return value
      const suffix = value.indexOf('('), name = suffix < 0 ? value : value.slice(0, suffix)
      if (resolveOperatorCharId(name.trim()) !== resolveOperatorCharId(targetOpId)) return value
      return (name.startsWith('char_') ? replacementOpId : restoreOperatorMowerName(replacementOpId)) + (suffix < 0 ? '' : value.slice(suffix))
    }
    const replaceList = (value: unknown): unknown => Array.isArray(value) ? value.map(replace) : typeof value === 'string' ? value.split(/[,，]/).map(replace).join(',') : value
    const replaceConf = (conf: Record<string, unknown>) => {
      for (const field of MOWER_OPERATOR_LIST_FIELDS) if (conf[field] !== undefined) conf[field] = replaceList(conf[field])
      if (record(conf.removed_operators)) for (const field of MOWER_OPERATOR_LIST_FIELDS) if (conf.removed_operators[field] !== undefined) conf.removed_operators[field] = replaceList(conf.removed_operators[field])
      if (record(conf.operator_mood_limits)) conf.operator_mood_limits = Object.fromEntries(Object.entries(conf.operator_mood_limits).map(([name, limits]) => [String(replace(name)), limits]))
    }
    replaceConf(workspace.value.mainPlan.conf)
    const advanced = workspace.value.compatibility.unrecognizedFields.advanced_settings
    if (record(advanced)) {
      if (Array.isArray(advanced.dorm_isolation)) advanced.dorm_isolation = advanced.dorm_isolation.map(group => Array.isArray(group) ? group.map(replace) : group)
      if (advanced.favorite !== undefined) advanced.favorite = replaceList(advanced.favorite)
    }
    for (const backup of workspace.value.compatibility.backupPlans) {
      if (!record(backup)) continue
      if (record(backup.conf)) replaceConf(backup.conf)
      if (record(backup.task)) for (const room of Object.keys(backup.task)) backup.task[room] = replaceList(backup.task[room])
      if (!record(backup.plan)) continue
      for (const facility of Object.values(backup.plan)) {
        if (!record(facility) || !Array.isArray(facility.plans)) continue
        for (const slot of facility.plans) {
          if (!record(slot)) continue
          slot.agent = replace(slot.agent)
          if (slot.replacement !== undefined) slot.replacement = replaceList(slot.replacement)
          if (Array.isArray(slot.group_bindings)) for (const binding of slot.group_bindings) if (record(binding) && binding.replacement !== undefined) binding.replacement = replaceList(binding.replacement)
        }
      }
    }
  }

  function updateConf(confPatch: Partial<MowerMainConf>): void {
    Object.assign(workspace.value.mainPlan.conf, structuredClone(toRaw(confPatch)))
  }

  function inferLevels(): void {
    inferFacilityLevels(workspace.value.mainPlan.facilities)
  }

  function resetWorkspace(): void {
    workspace.value = createDefaultWorkspace()
    selectedRoomId.value = 'room_1_1'
  }

  function clearAllOperators(): void {
    const facilities = workspace.value.mainPlan.facilities
    for (const roomId of Object.keys(facilities) as MowerRoomId[]) {
      const facility = facilities[roomId]
      if (!facility) continue
      for (const slot of facility.slots) {
        slot.occupant = { kind: 'empty' }
        delete slot.dormitoryResident
        slot.groupId = null
        slot.replacements = []
        delete slot.groupBindings
        delete slot.metadata
      }
    }
  }

  function addBackupPlan(plan?: unknown): number {
    workspace.value.compatibility.backupPlans ??= []
    const plans = workspace.value.compatibility.backupPlans
    const newPlan = plan ? structuredClone(toRaw(plan)) : {
      name: `副表 #${plans.length + 1}`,
      trigger: 'True',
      task: {},
      plan: {},
      conf: {
        ling_xi: 1,
        exhaust_require: '',
        rest_in_full: '',
        resting_priority: '',
        workaholic: '',
        free_blacklist: '',
      },
    }
    plans.push(newPlan)
    workspace.value.compatibility.importedHasBackupPlans = true
    return plans.length - 1
  }

  function updateBackupPlan(index: number, patch: unknown): void {
    workspace.value.compatibility.backupPlans ??= []
    const plans = workspace.value.compatibility.backupPlans
    if (index >= 0 && index < plans.length) {
      plans[index] = structuredClone(toRaw(patch))
      workspace.value.compatibility.importedHasBackupPlans = true
    }
  }

  function removeBackupPlan(index: number): void {
    workspace.value.compatibility.backupPlans ??= []
    const plans = workspace.value.compatibility.backupPlans
    if (index >= 0 && index < plans.length) {
      plans.splice(index, 1)
      workspace.value.compatibility.importedHasBackupPlans = true
    }
  }

  function moveBackupPlan(fromIndex: number, toIndex: number): void {
    workspace.value.compatibility.backupPlans ??= []
    const plans = workspace.value.compatibility.backupPlans
    if (
      fromIndex >= 0 &&
      fromIndex < plans.length &&
      toIndex >= 0 &&
      toIndex < plans.length &&
      fromIndex !== toIndex
    ) {
      const [moved] = plans.splice(fromIndex, 1)
      plans.splice(toIndex, 0, moved)
      workspace.value.compatibility.importedHasBackupPlans = true
    }
  }

  function duplicateBackupPlan(index: number): number {
    workspace.value.compatibility.backupPlans ??= []
    const plans = workspace.value.compatibility.backupPlans
    if (index >= 0 && index < plans.length) {
      const source = plans[index] as Record<string, unknown>
      const clone = structuredClone(toRaw(source))
      clone.name = `${source.name ?? '副表'} (副本)`
      plans.splice(index + 1, 0, clone)
      workspace.value.compatibility.importedHasBackupPlans = true
      return index + 1
    }
    return -1
  }

  function clearBackupPlans(): void {
    workspace.value.compatibility.backupPlans = []
    workspace.value.compatibility.importedHasBackupPlans = true
  }

  return {
    workspace,
    selectedRoomId,
    selectedRoom,
    loadWorkspace,
    selectRoom,
    swapOutputRooms,
    updateFacility,
    updateSlot,
    updateSlotOccupant,
    updateSlotGroup,
    setReplacements,
    addReplacement,
    removeReplacement,
    reorderReplacements,
    replaceOperatorGlobally,
    updateConf,
    inferLevels,
    resetWorkspace,
    clearAllOperators,
    addBackupPlan,
    updateBackupPlan,
    removeBackupPlan,
    moveBackupPlan,
    duplicateBackupPlan,
    clearBackupPlans,
  }
})

