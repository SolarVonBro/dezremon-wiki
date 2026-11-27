// Reactive shared drag-and-drop state for PF2e Library <-> Character workspace.
// HTML5 dragover cannot read dataTransfer payloads, so reactive refs power instant
// valid/invalid slot highlighting and live heightened damage previews while dragging!
import { ref } from 'vue'
import type { Pf2eInventoryItem, Pf2eItemIndex, Pf2eSpellEntryItem, Pf2eSpellIndex } from '@/model/pf2e'

export type Pf2eDragPayload =
  | { kind: 'library-spell'; spell: Pf2eSpellIndex }
  | { kind: 'char-spell'; listId: string; row: Pf2eSpellEntryItem; spell: Pf2eSpellIndex | null }
  | { kind: 'library-item'; item: Pf2eItemIndex }
  | { kind: 'char-item'; row: Pf2eInventoryItem; item: Pf2eItemIndex | null }

const currentDrag = ref<Pf2eDragPayload | null>(null)

export function startPf2eDrag(payload: Pf2eDragPayload) {
  currentDrag.value = payload
}

export function endPf2eDrag() {
  currentDrag.value = null
}

export function usePf2eDrag() {
  return { currentDrag, startPf2eDrag, endPf2eDrag }
}
