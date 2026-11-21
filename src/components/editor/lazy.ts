import { defineAsyncComponent } from 'vue'
import type RichEditorComponent from './RichEditor.vue'

/**
 * The editor (TipTap + ProseMirror, ~250 KB gzip) is loaded only when someone actually edits,
 * so readers and guests never download it. Template refs still reach the inner component.
 */
export const RichEditor = defineAsyncComponent({
  loader: () => import('./RichEditor.vue'),
  delay: 0,
}) as unknown as typeof RichEditorComponent
export type RichEditorInstance = InstanceType<typeof RichEditorComponent>
