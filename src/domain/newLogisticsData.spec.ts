import { describe, expect, it } from 'vitest'
import { OPERATOR_MAP } from './operators'
import { selectUnlockedSkills } from './operatorInventory'

describe('v078 logistics skill stages', () => {
  it.each([
    ['char_393_toledo', '德·托莱多', ['hire_spd_cost[113]'], ['hire_spd_cost[122]', 'dorm_hireToRecAll[002]']],
    ['char_4232_hbound', '旅骨', ['recycle_spd&cost[000]'], ['recycle_spd&cost[010]', 'workshop_formula_device[080]']],
    ['char_4231_clemnt', '克莱门莎', ['meet_spd&cost[110]'], ['meet_spd&cost[110]', 'meet_spd&cost_char[000]']],
  ])('selects independent unlocked slots for %s', (id, name, initial, promoted) => {
    const operator = OPERATOR_MAP.get(id as string)
    expect(operator?.name).toBe(name)
    expect(selectUnlockedSkills(operator!, 0, 1).map(skill => skill.buffId)).toEqual(initial)
    expect(selectUnlockedSkills(operator!, 1, 1).map(skill => skill.buffId)).toEqual(initial)
    expect(selectUnlockedSkills(operator!, 2, 1).map(skill => skill.buffId)).toEqual(promoted)
  })
})
