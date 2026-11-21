// Batched Firestore writes for restore/import: at most 450 operations and ~8 MB per commit
// (Firestore limits: 500 ops per batch, 10 MiB per request). Transient errors are retried;
// quota errors propagate so the caller can report how far it got.
import { writeBatch, type DocumentReference } from 'firebase/firestore'
import { db } from '@/firebase'
import { utf8Length } from './format'

const MAX_OPS = 450
const MAX_BYTES = 8_000_000
const RETRYABLE = new Set(['unavailable', 'deadline-exceeded', 'aborted', 'internal'])

type Op =
  | { kind: 'set'; ref: DocumentReference; data: Record<string, any> }
  | { kind: 'update'; ref: DocumentReference; data: Record<string, any> }
  | { kind: 'delete'; ref: DocumentReference }

export function approxDocSize(data: unknown): number {
  try {
    return utf8Length(JSON.stringify(data) ?? '') + 64
  } catch {
    return 1024
  }
}

export class BatchWriter {
  /** Operations committed so far. */
  writes = 0
  private ops: Op[] = []
  private bytes = 0
  private readonly maxOps: number
  private readonly maxBytes: number
  private readonly onCommit?: (writes: number) => void

  constructor(opts: { maxOps?: number; maxBytes?: number; onCommit?: (writes: number) => void } = {}) {
    this.maxOps = Math.min(opts.maxOps ?? MAX_OPS, 499)
    this.maxBytes = opts.maxBytes ?? MAX_BYTES
    this.onCommit = opts.onCommit
  }

  /** Operations queued but not yet committed. */
  get queued() { return this.ops.length }

  private async push(op: Op, size: number) {
    if (this.ops.length > 0 && (this.ops.length + 1 > this.maxOps || this.bytes + size > this.maxBytes)) await this.flush()
    this.ops.push(op)
    this.bytes += size
  }

  set(ref: DocumentReference, data: Record<string, any>, sizeHint?: number) {
    return this.push({ kind: 'set', ref, data }, sizeHint ?? approxDocSize(data))
  }

  update(ref: DocumentReference, data: Record<string, any>) {
    return this.push({ kind: 'update', ref, data }, approxDocSize(data))
  }

  delete(ref: DocumentReference) {
    return this.push({ kind: 'delete', ref }, 128)
  }

  async flush() {
    if (!this.ops.length) return
    const ops = this.ops
    this.ops = []
    this.bytes = 0
    for (let attempt = 0; ; attempt++) {
      // A WriteBatch cannot be committed twice, so it is rebuilt for every attempt.
      const b = writeBatch(db)
      for (const op of ops) {
        if (op.kind === 'set') b.set(op.ref, op.data)
        else if (op.kind === 'update') b.update(op.ref, op.data)
        else b.delete(op.ref)
      }
      try {
        await b.commit()
        break
      } catch (e: any) {
        if (attempt < 3 && RETRYABLE.has(String(e?.code ?? ''))) {
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
          continue
        }
        throw e
      }
    }
    this.writes += ops.length
    this.onCommit?.(this.writes)
  }
}
