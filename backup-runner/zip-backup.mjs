#!/usr/bin/env node
// Packs one world folder of the automatic backup into a ZIP that the app can restore
// (Мир → Резервные копии → Восстановление).
//
//   node zip-backup.mjs ../backups/<worldId> [out.zip]
//
// No dependencies: a minimal ZIP writer (deflate for text, store for already-compressed images).
import { closeSync, openSync, readFileSync, readdirSync, statSync, writeSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import zlib from 'node:zlib'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

function walk(dir, base = dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) walk(abs, base, out)
    else if (e.isFile()) out.push({ abs, rel: path.relative(base, abs).split(path.sep).join('/') })
  }
  return out
}

const STORE_EXT = /\.(webp|png|jpe?g|gif|avif|zip|gz)$/i

/** Writes `files` ([{ rel, abs }]) into a ZIP at `outFile`. Returns the number of entries. */
export function writeZip(outFile, files) {
  if (files.length >= 0xffff) throw new Error('Слишком много файлов для ZIP без ZIP64')
  const fd = openSync(outFile, 'w')
  let offset = 0
  const central = []
  const write = (buf) => { writeSync(fd, buf); offset += buf.length }
  try {
    for (const f of files) {
      const data = readFileSync(f.abs)
      const store = STORE_EXT.test(f.rel)
      const body = store ? data : zlib.deflateRawSync(data, { level: 6 })
      if (offset > 0xfffffff0 || body.length > 0xfffffff0) throw new Error('Архив больше 4 ГБ — ZIP64 не поддерживается')
      const name = Buffer.from(f.rel, 'utf8')
      const crc = crc32(data)
      const { time, date } = dosDateTime(statSync(f.abs).mtime)
      const local = Buffer.alloc(30)
      local.writeUInt32LE(0x04034b50, 0)
      local.writeUInt16LE(20, 4)
      local.writeUInt16LE(0x0800, 6) // UTF-8 names
      local.writeUInt16LE(store ? 0 : 8, 8)
      local.writeUInt16LE(time, 10)
      local.writeUInt16LE(date, 12)
      local.writeUInt32LE(crc, 14)
      local.writeUInt32LE(body.length, 18)
      local.writeUInt32LE(data.length, 22)
      local.writeUInt16LE(name.length, 26)
      local.writeUInt16LE(0, 28)
      const at = offset
      write(local)
      write(name)
      write(body)
      const c = Buffer.alloc(46)
      c.writeUInt32LE(0x02014b50, 0)
      c.writeUInt16LE(20, 4)
      c.writeUInt16LE(20, 6)
      c.writeUInt16LE(0x0800, 8)
      c.writeUInt16LE(store ? 0 : 8, 10)
      c.writeUInt16LE(time, 12)
      c.writeUInt16LE(date, 14)
      c.writeUInt32LE(crc, 16)
      c.writeUInt32LE(body.length, 20)
      c.writeUInt32LE(data.length, 24)
      c.writeUInt16LE(name.length, 28)
      c.writeUInt16LE(0, 30)
      c.writeUInt16LE(0, 32)
      c.writeUInt16LE(0, 34)
      c.writeUInt16LE(0, 36)
      c.writeUInt32LE(0, 38)
      c.writeUInt32LE(at, 42)
      central.push(Buffer.concat([c, name]))
    }
    const cdStart = offset
    for (const c of central) write(c)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(0, 4)
    end.writeUInt16LE(0, 6)
    end.writeUInt16LE(central.length, 8)
    end.writeUInt16LE(central.length, 10)
    end.writeUInt32LE(offset - cdStart, 12)
    end.writeUInt32LE(cdStart, 16)
    end.writeUInt16LE(0, 20)
    write(end)
  } finally {
    closeSync(fd)
  }
  return central.length
}

/** Zips a world backup folder (must contain manifest.json). */
export function zipWorldFolder(folder, outFile) {
  const dir = path.resolve(folder)
  const manifestPath = path.join(dir, 'manifest.json')
  let manifest
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch {
    throw new Error(`В папке ${dir} нет manifest.json — укажите папку мира, например backups/<worldId>`)
  }
  if (manifest.format !== 'dezremon-wiki-backup') throw new Error('manifest.json не похож на резервную копию Dezremon Wiki')
  const date = String(manifest.exportedAt ?? new Date().toISOString()).slice(0, 10)
  const out = path.resolve(outFile ?? `${path.basename(dir)}-${date}.zip`)
  const files = walk(dir).filter((f) => f.abs !== out)
  const n = writeZip(out, files)
  return { out, entries: n, world: manifest.world?.name ?? path.basename(dir) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [folder, out] = process.argv.slice(2)
  if (!folder) {
    console.error('Использование: node zip-backup.mjs <папка мира, напр. ../backups/AbCd123> [файл.zip]')
    process.exit(1)
  }
  try {
    const r = zipWorldFolder(folder, out)
    console.log(`Готово: ${r.out} (${r.entries} файлов, мир «${r.world}»). Восстановите его в приложении: Резервные копии → Восстановление.`)
  } catch (e) {
    console.error(e?.message ?? e)
    process.exit(1)
  }
}
