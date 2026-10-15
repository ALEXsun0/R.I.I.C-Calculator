/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'
import { formatRiicSkillDescription, type RiicSkillSynergy } from './riicSkillDescription'
import { getOperatorAvatarUrl } from './operatorHelpers'
import rawOperators from '../data/riic-skills-database.json'

function render(description: string, synergy: RiicSkillSynergy | null = null, avatarUrl = getOperatorAvatarUrl): HTMLDivElement {
  const root = document.createElement('div')
  root.innerHTML = formatRiicSkillDescription(description, synergy, avatarUrl)
  return root
}

function texts(root: ParentNode, selector: string): string[] {
  return [...root.querySelectorAll(selector)].map(element => element.textContent ?? '')
}

describe('formatRiicSkillDescription', () => {
  it('highlights original signed, decimal and percentage values only in description text', () => {
    const description = '生产力+30%，每小时-0.25，恢复+0.15，人数2，额外-5%，倍率1.5'
    const root = render(description)
    expect(root.textContent).toBe(description)
    expect(texts(root, '.stat-num')).toEqual(['+30%', '-0.25', '+0.15', '2', '-5%', '1.5'])
    expect(formatRiicSkillDescription('', null, getOperatorAvatarUrl)).toBe('')
  })

  it('escapes original HTML characters before generating markup without corrupting entities', () => {
    const description = '<script>5</script> & "6" < 7 > \'8\''
    const root = render(description)
    expect(root.textContent).toBe(description)
    expect(root.querySelector('script')).toBeNull()
    expect(texts(root, '.stat-num')).toEqual(['5', '6', '7', '8'])
    expect(root.innerHTML).toContain('&amp;')
  })

  it('preserves numeric operator names and their exact real avatar URLs', () => {
    const operators = ['Lancet-2', '12F', 'Castle-3']
    const root = render(`${operators.join('、')}使恢复+0.25`, { operators })
    expect(texts(root, '.tag-op')).toEqual(operators.map(name => `@${name}`))
    expect([...root.querySelectorAll('img')].map(image => image.getAttribute('src'))).toEqual(operators.map(getOperatorAvatarUrl))
    expect(root.querySelector('.tag-op .stat-num')).toBeNull()
    expect(texts(root, ':scope > .stat-num')).toEqual(['+0.25'])
  })

  it('renders every real Alanna skill with its source faction members and linked avatar', () => {
    const alanna = rawOperators.find(operator => operator.name === '阿兰娜')!
    for (const skill of alanna.skills) {
      const root = render(skill.description, skill.synergy)
      expect(root.textContent).not.toContain('___FACTION_')
      for (const faction of skill.synergy?.factions ?? []) {
        expect(texts(root, '.tag-faction')).toEqual([`🏛️ ${faction.name}`])
        expect(texts(root, '.popover-op-chip > span')).toEqual(faction.members)
        expect(texts(root, '.popover-header')).toEqual([`🏛️ ${faction.name} 成员名单 (${faction.members.length}人)`])
      }
      for (const operator of skill.synergy?.operators ?? []) {
        expect(texts(root, '.tag-op')).toContain(`@${operator}`)
        expect(root.querySelector('.chip-avatar-inline')?.getAttribute('src')).toBe(getOperatorAvatarUrl(operator))
      }
      expect(root.querySelector('.tag-faction-wrap .stat-num, .tag-op-wrap .stat-num')).toBeNull()
    }
  })

  it('handles multiple factions and repeated mentions without reprocessing tags or members', () => {
    const synergy = {
      factions: [
        { name: '作业平台', members: ['Lancet-2', 'Castle-3'] },
        { name: '莱茵科技', members: ['赫默', '塞雷娅'] },
      ],
      operators: ['Lancet-2'],
    }
    const root = render('作业平台和莱茵科技；作业平台与Lancet-2额外+2', synergy)
    expect(texts(root, '.tag-faction')).toEqual(['🏛️ 作业平台', '🏛️ 莱茵科技', '🏛️ 作业平台'])
    expect(texts(root, '.tag-op')).toEqual(['@Lancet-2'])
    expect(root.querySelector('.popover-op-chip .tag-op-wrap')).toBeNull()
    expect(root.querySelector('.popover-op-chip .stat-num')).toBeNull()
    expect(texts(root, ':scope > .stat-num')).toEqual(['+2'])
  })

  it('deduplicates metadata terms while preserving repeated source mentions and first faction membership', () => {
    const root = render('作业平台、温米、作业平台、温米', {
      factions: [
        { name: '作业平台', members: ['Castle-3'] },
        { name: '作业平台', members: ['12F'] },
      ],
      operators: ['温米', '温米'],
    })
    expect(texts(root, '.tag-faction')).toHaveLength(2)
    expect(texts(root, '.popover-op-chip > span')).toEqual(['Castle-3', 'Castle-3'])
    expect(texts(root, '.tag-op')).toEqual(['@温米', '@温米'])
  })

  it('matches complete overlapping terms independent of metadata order', () => {
    const description = '缄默德克萨斯和德克萨斯在莱茵科技、莱茵中'
    const factions = [{ name: '莱茵', members: [] }, { name: '莱茵科技', members: [] }]
    const operators = ['德克萨斯', '缄默德克萨斯']
    for (const synergy of [{ factions, operators }, { factions: [...factions].reverse(), operators: [...operators].reverse() }]) {
      const root = render(description, synergy)
      expect(texts(root, '.tag-op')).toEqual(['@缄默德克萨斯', '@德克萨斯'])
      expect(texts(root, '.tag-faction')).toEqual(['🏛️ 莱茵科技', '🏛️ 莱茵'])
      expect(root.querySelector('.tag-op-wrap .tag-op-wrap, .tag-faction-wrap .tag-faction-wrap')).toBeNull()
    }
  })

  it('treats regular expression punctuation literally and ignores empty metadata names', () => {
    const root = render('S.E.E.S.、A+B (12)、SxExExSx，额外3', {
      factions: [{ name: 'S.E.E.S.', members: [] }, { name: '', members: ['12F'] }],
      operators: ['A+B (12)', ''],
    })
    expect(texts(root, '.tag-faction')).toEqual(['🏛️ S.E.E.S.'])
    expect(texts(root, '.tag-op')).toEqual(['@A+B (12)'])
    expect(texts(root, ':scope > .stat-num')).toEqual(['3'])
    expect(root.textContent).toContain('SxExExSx')
  })

  it('retains faction precedence for an identically named operator', () => {
    const root = render('共同名+5%', { factions: [{ name: '共同名', members: ['12F'] }], operators: ['共同名'] })
    expect(texts(root, '.tag-faction')).toEqual(['🏛️ 共同名'])
    expect(root.querySelector('.tag-op')).toBeNull()
    expect(texts(root, ':scope > .stat-num')).toEqual(['+5%'])
  })

  it('escapes linked names, popover members and URL attributes without highlighting encoded URL digits', () => {
    const faction = '派系<&"\'12>'
    const operator = '干员<&"\'3>'
    const member = '成员<&"\'2>'
    const url = 'https://cdn.example/avatar/%E6%B8%A9.webp?v=12&label="quoted"&single=\'x\''
    const root = render(`${faction}与${operator}提供+0.2`, { factions: [{ name: faction, members: [member] }], operators: [operator] }, () => url)
    expect(texts(root, '.tag-faction')).toEqual([`🏛️ ${faction}`])
    expect(texts(root, '.tag-op')).toEqual([`@${operator}`])
    expect(texts(root, '.popover-op-chip > span')).toEqual([member])
    expect(texts(root, '.popover-header')).toEqual([`🏛️ ${faction} 成员名单 (1人)`])
    const images = [...root.querySelectorAll('img')]
    expect(images).toHaveLength(2)
    for (const image of images) {
      expect(image.getAttribute('src')).toBe(url)
      expect(image.getAttributeNames().sort()).toEqual(['class', 'onerror', 'src'])
      expect(image.getAttribute('onerror')).toBe("this.style.display='none'")
    }
    expect(root.querySelector('.tag-faction-wrap .stat-num, .tag-op-wrap .stat-num')).toBeNull()
    expect(texts(root, ':scope > .stat-num')).toEqual(['+0.2'])
  })
})
