import { mergeAttributes } from '@tiptap/core'
import Mention from '@tiptap/extension-mention'
import { PluginKey } from '@tiptap/pm/state'
import { popupRender } from './popup'
import MentionList from '../MentionList.vue'

/** Link to another article: <a class="mention" data-entity-id="…">Имя</a>. Triggered by "@" or "[[". */
export const EntityMention = Mention.extend({
  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute('data-entity-id'), renderHTML: (a) => ({ 'data-entity-id': a.id }) },
      label: { default: '', parseHTML: (el) => el.textContent ?? '', renderHTML: () => ({}) },
      custom: { default: false, parseHTML: (el) => el.hasAttribute('data-label'), renderHTML: (a) => (a.custom ? { 'data-label': '' } : {}) },
    }
  },
  parseHTML() { return [{ tag: 'a[data-entity-id]', priority: 80 }] },
  renderHTML({ node, HTMLAttributes }) {
    return ['a', mergeAttributes({ class: 'mention', href: `#e:${node.attrs.id}` }, HTMLAttributes), node.attrs.label || '…']
  },
  renderText({ node }) { return node.attrs.label ?? '' },
}).configure({
  deleteTriggerWithBackspace: true,
  suggestions: [
    { char: '@', pluginKey: new PluginKey('mention-at'), allowSpaces: true, items: () => [], render: popupRender(MentionList) },
    { char: '[[', pluginKey: new PluginKey('mention-brackets'), allowSpaces: true, items: () => [], render: popupRender(MentionList) },
  ],
})
