import { ref } from 'vue'

/**
 * Global "create article" request (sidebar button, N hotkey, "+ child" buttons). `mine`: a character of one's own
 * (the «+» of «Мои персонажи»): the creation window starts with «Мой персонаж» checked.
 */
export const createRequest = ref<{ type: string | null; parentId?: string | null; mine?: boolean } | null>(null)
