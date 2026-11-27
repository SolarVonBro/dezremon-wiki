// Shared PF2e workspace context: remembers the active working character across
// Characters / Spell Library / Item Library / Standalone Spell & Item pages so
// adding spells/items to a character takes 1 click without cramped modals.
import { ref } from 'vue'

const LS_KEY = 'pf2e_active_char_id'

function loadStoredCharId(): string {
  try { return localStorage.getItem(LS_KEY) ?? '' } catch { return '' }
}

const activeCharId = ref<string>(loadStoredCharId())
const targetListId = ref<string>('')
const targetRank = ref<number | null>(null)
const targetContainerId = ref<string>('')
const targetGroup = ref<string>('')

export function setActivePf2eChar(cid: string) {
  activeCharId.value = cid
  try {
    if (cid) localStorage.setItem(LS_KEY, cid)
    else localStorage.removeItem(LS_KEY)
  } catch { /* ignore storage quota/private mode */ }
}

export function setSpellPickTarget(cid: string, listId = '', rank: number | null = null) {
  setActivePf2eChar(cid)
  targetListId.value = listId
  targetRank.value = rank
}

export function setItemPickTarget(cid: string, containerId = '', group = '') {
  setActivePf2eChar(cid)
  targetContainerId.value = containerId
  targetGroup.value = group
}

export function usePf2eWorkspace() {
  return {
    activeCharId,
    targetListId,
    targetRank,
    targetContainerId,
    targetGroup,
    setActivePf2eChar,
    setSpellPickTarget,
    setItemPickTarget,
  }
}
