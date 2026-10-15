export interface RiicSkillSynergyFaction {
  name: string
  members: string[]
}

export interface RiicSkillSynergy {
  operators?: string[]
  factions?: RiicSkillSynergyFaction[]
}

const htmlEntities: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, character => htmlEntities[character]!)
}

function highlightText(text: string): string {
  let html = ''
  let offset = 0
  for (const match of text.matchAll(/[+-]?\d+(?:\.\d+)?%?/g)) {
    html += escapeHtml(text.slice(offset, match.index))
    html += `<span class="stat-num">${escapeHtml(match[0])}</span>`
    offset = match.index + match[0].length
  }
  return html + escapeHtml(text.slice(offset))
}

/** Match links in source text first; numeric highlighting never receives generated HTML. */
export function formatRiicSkillDescription(
  description: string,
  synergy: RiicSkillSynergy | null,
  avatarUrl: (name: string) => string,
): string {
  const tags = new Map<string, string>()
  for (const faction of synergy?.factions ?? []) {
    if (!faction.name || tags.has(faction.name)) continue
    const name = escapeHtml(faction.name)
    const members = faction.members.map(member =>
      `<span class="popover-op-chip"><img class="popover-chip-avatar" src="${escapeHtml(avatarUrl(member))}" onerror="this.style.display='none'" /><span>${escapeHtml(member)}</span></span>`,
    ).join('')
    tags.set(faction.name, `<span class="tag-faction-wrap"><span class="tag-faction">🏛️ ${name}</span><span class="faction-popover"><span class="popover-header">🏛️ ${name} 成员名单 (${faction.members.length}人)</span><span class="popover-members">${members}</span></span></span>`)
  }
  for (const operator of synergy?.operators ?? []) {
    if (!operator || tags.has(operator)) continue
    tags.set(operator, `<span class="tag-op-wrap"><span class="tag-op"><img class="chip-avatar-inline" src="${escapeHtml(avatarUrl(operator))}" onerror="this.style.display='none'" /><span>@${escapeHtml(operator)}</span></span></span>`)
  }
  if (!tags.size) return highlightText(description)

  // Prefer the complete, longest name when one linked name contains another.
  // Factions retain precedence over identically named operators, as before.
  const names = [...tags.keys()].sort((left, right) => right.length - left.length)
  const pattern = new RegExp(names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
  let html = ''
  let offset = 0
  for (const match of description.matchAll(pattern)) {
    html += highlightText(description.slice(offset, match.index))
    html += tags.get(match[0])!
    offset = match.index + match[0].length
  }
  return html + highlightText(description.slice(offset))
}
