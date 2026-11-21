import { reactive } from 'vue'

export interface ToastItem { id: number; kind: 'info' | 'success' | 'error'; text: string }

export const toasts = reactive<ToastItem[]>([])
let seq = 0

function push(kind: ToastItem['kind'], text: string, ms = 4000) {
  const id = ++seq
  toasts.push({ id, kind, text })
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id)
    if (i >= 0) toasts.splice(i, 1)
  }, kind === 'error' ? Math.max(ms, 7000) : ms)
}

export const toast = {
  info: (t: string) => push('info', t),
  success: (t: string) => push('success', t),
  error: (t: string) => push('error', t),
}
