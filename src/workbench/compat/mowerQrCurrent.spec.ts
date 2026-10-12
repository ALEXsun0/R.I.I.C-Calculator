import { describe, expect, it } from 'vitest'
import { decodeRosterFrom16QrChunks, decode16QrFromRgba, encodeRosterTo16QrChunks, render16QrToRgba } from './mowerQrCodec'
import { QRCODE_SIZE, QR_SLOT_POSITIONS } from './mowerQrConstants'

const document = JSON.stringify({ default: 'plan1', plan1: { recycle: { name: '', plans: [{ agent: '旅骨', replacement: ['芬'], group: '转化' }, { agent: '砾', replacement: ['香草'], group: '转化' }] } } })

describe('current Mower 14 QR image compatibility', () => {
  it('uses fourteen floor-split zlib/Base45 chunks and decodes a complete payload', () => {
    const chunks = encodeRosterTo16QrChunks(document, 14)
    expect(chunks).toHaveLength(14)
    expect(chunks.slice(0, -1).every(chunk => chunk.length === Math.floor(chunks.join('').length / 14))).toBe(true)
    expect(decodeRosterFrom16QrChunks(chunks.join(''))).toBe(document)
    expect(decodeRosterFrom16QrChunks(chunks)).toBe(document)
  })

  it.each(['light', 'dark'] as const)('roundtrips a complete %s image while preserving the bottom-right facility cards', theme => {
    const width = 3012, height = 1236
    const base = new Uint8ClampedArray(width * height * 4).fill(theme === 'light' ? 237 : 19)
    for (let i = 3; i < base.length; i += 4) base[i] = 255
    const image = render16QrToRgba(width, height, document, theme, base, 14)
    expect(decode16QrFromRgba(image, width, height)).toBe(document)
    for (const slot of QR_SLOT_POSITIONS.slice(14)) {
      for (let row = 0; row < QRCODE_SIZE; row++) {
        const start = ((slot.y + row) * width + slot.x) * 4
        expect(image.subarray(start, start + QRCODE_SIZE * 4)).toEqual(base.subarray(start, start + QRCODE_SIZE * 4))
      }
    }
  })

  it('supports the current compact 7-by-2 layout canvas', () => {
    const width = 1657, height = 1226
    expect(decode16QrFromRgba(render16QrToRgba(width, height, document, 'light', undefined, 14), width, height)).toBe(document)
  })

  it('orders QR rows by geometry when a picture has been padded and translated', () => {
    const sourceWidth = 3012, sourceHeight = 1236, width = 3212, height = 2736, dx = 100, dy = 200
    const source = render16QrToRgba(sourceWidth, sourceHeight, document, 'light', undefined, 14)
    const padded = new Uint8ClampedArray(width * height * 4).fill(255)
    for (let y = 0; y < sourceHeight; y++) {
      padded.set(source.subarray(y * sourceWidth * 4, (y + 1) * sourceWidth * 4), ((y + dy) * width + dx) * 4)
    }
    expect(decode16QrFromRgba(padded, width, height)).toBe(document)
  }, 60000)

  it('rejects a truncated legacy sixteen-code payload even when fourteen codes are readable', () => {
    const width = 3012, height = 1236
    const image = render16QrToRgba(width, height, document)
    for (const slot of QR_SLOT_POSITIONS.slice(14)) {
      for (let row = 0; row < QRCODE_SIZE; row++) image.fill(255, ((slot.y + row) * width + slot.x) * 4, ((slot.y + row) * width + slot.x + QRCODE_SIZE) * 4)
    }
    expect(() => decode16QrFromRgba(image, width, height)).toThrow(/Corrupted payload/)
    expect(() => decodeRosterFrom16QrChunks(encodeRosterTo16QrChunks(document).slice(0, 14).join(''))).toThrow(/Corrupted payload/)
  })
})
