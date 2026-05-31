export const PAGE_SIZES = {
  a4: { w: 900, h: 1273 }, // 210×297mm
  letter: { w: 900, h: 1165 } // 8.5×11in
} as const

export const PAGE_SIZES_PT = {
  letter: [612, 792] as [number, number],
  a4: [595, 842] as [number, number]
} as const

export type PageSizeKey = keyof typeof PAGE_SIZES
