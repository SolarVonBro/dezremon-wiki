import { ref } from 'vue'

/** Global "create article" request (sidebar button, N hotkey, "+ child" buttons). */
export const createRequest = ref<{ type: string | null; parentId?: string | null } | null>(null)
