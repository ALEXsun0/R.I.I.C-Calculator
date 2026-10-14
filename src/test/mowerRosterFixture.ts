import type { RosterWorkspace } from '../domain/roster'

/** Add explicitly available recovery beds to a cloned test fixture. */
export function withMowerFreeBeds(workspace: RosterWorkspace, count = 3): RosterWorkspace {
  const fixture = structuredClone(workspace)
  const available = Object.values(fixture.mainPlan.facilities)
    .filter(room => room.type === 'dormitory' && room.level > 0)
    .flatMap(room => room.slots.slice(2).filter(slot => slot.occupant.kind === 'empty'
      && !slot.groupId && !slot.groupBindings?.length && !slot.replacements.length
      && !Object.keys(slot.metadata ?? {}).length))
  if (!Number.isSafeInteger(count) || count < 0 || count > available.length) {
    throw new Error('Fixture needs enough unreserved dormitory slots for its Free beds')
  }
  for (const slot of available.slice(0, count)) slot.occupant = { kind: 'free' }
  return fixture
}
