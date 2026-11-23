// Comments under articles (worlds/{w}/comments). They are read only when a reader opens the discussion; the number
// lives in the article (entity.commentCount) and changes in the same batch as the comment, together with updatedAt —
// otherwise readers with a cached copy of the article would never see the new number (sync follows updatedAt).
import { arrayRemove, arrayUnion, doc, increment, updateDoc, writeBatch } from 'firebase/firestore'
import { db } from '@/firebase'
import { coll, docRef } from './access'
import { clean, now } from './util'
import type { Comment, Entity, Visible } from '@/model/types'

export const COMMENT_MAX = 4000

/** A comment is visible to whoever can read the article; the article's author always sees its discussion. */
export function commentVisibility(e: Pick<Entity, 'visibility' | 'allowedUids' | 'createdBy'>): Pick<Visible, 'visibility' | 'allowedUids'> {
  return { visibility: e.visibility, allowedUids: [...new Set([...(e.allowedUids ?? []), e.createdBy].filter(Boolean))] }
}

export interface Author { uid: string; name: string; photo: string | null }

function bump(batch: ReturnType<typeof writeBatch>, wid: string, entityId: string, by: number, t: number) {
  batch.update(docRef(wid, 'entities', entityId), { commentCount: increment(by), updatedAt: t, ...(by > 0 ? { commentedAt: t } : {}) })
}

export async function addComment(wid: string, e: Entity, author: Author, text: string, reply: { parentId: string; toUid: string; toName: string } | null): Promise<string> {
  const ref = doc(coll(wid, 'comments'))
  const t = now()
  const c: Comment = {
    id: ref.id, entityId: e.id, parentId: reply?.parentId ?? null, replyToUid: reply?.toUid ?? null, replyToName: reply?.toName ?? '',
    text: text.trim().slice(0, COMMENT_MAX), authorName: author.name, authorPhoto: author.photo, likes: [], editedAt: null, removed: false,
    ...commentVisibility(e), createdBy: author.uid, updatedBy: author.uid, createdAt: t, updatedAt: t,
  }
  const batch = writeBatch(db)
  batch.set(ref, clean(c))
  bump(batch, wid, e.id, 1, t)
  await batch.commit()
  return ref.id
}

export async function editComment(wid: string, c: Comment, text: string, by: string) {
  const t = now()
  await updateDoc(docRef(wid, 'comments', c.id), { text: text.trim().slice(0, COMMENT_MAX), editedAt: t, updatedAt: t, updatedBy: by })
}

/**
 * Deletes a comment. One with replies stays as «Комментарий удалён» (text wiped); a reply that was the last one under
 * such a placeholder takes the placeholder with it.
 */
export async function deleteComment(wid: string, c: Comment, all: Comment[], by: string) {
  const t = now()
  const batch = writeBatch(db)
  const replies = all.filter((x) => x.parentId === c.id)
  if (!c.parentId && replies.length) {
    batch.update(docRef(wid, 'comments', c.id), { text: '', removed: true, updatedAt: t, updatedBy: by })
  } else {
    batch.delete(docRef(wid, 'comments', c.id))
    const parent = c.parentId ? all.find((x) => x.id === c.parentId) : null
    if (parent?.removed && !all.some((x) => x.parentId === parent.id && x.id !== c.id)) batch.delete(docRef(wid, 'comments', parent.id))
  }
  bump(batch, wid, c.entityId, -1, t)
  await batch.commit()
}

export async function toggleLike(wid: string, c: Comment, uid: string) {
  await updateDoc(docRef(wid, 'comments', c.id), { likes: c.likes.includes(uid) ? arrayRemove(uid) : arrayUnion(uid) })
}

/** The article's visibility changed: its comments follow (they are not synced, so this is the only place). */
export async function syncCommentVisibility(wid: string, e: Entity, rows: Comment[]) {
  const vis = commentVisibility(e)
  const todo = rows.filter((c) => c.visibility !== vis.visibility || JSON.stringify(c.allowedUids ?? []) !== JSON.stringify(vis.allowedUids))
  for (let i = 0; i < todo.length; i += 400) {
    const batch = writeBatch(db)
    todo.slice(i, i + 400).forEach((c) => batch.update(docRef(wid, 'comments', c.id), { ...vis }))
    await batch.commit()
  }
  return todo.length
}
