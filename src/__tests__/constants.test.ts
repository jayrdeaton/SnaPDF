import { PAGE_SIZES, PAGE_SIZES_PT } from '../constants'

describe('PAGE_SIZES', () => {
  it('letter has correct viewport dimensions', () => {
    expect(PAGE_SIZES.letter).toEqual({ w: 900, h: 1165 })
  })

  it('a4 has correct viewport dimensions', () => {
    expect(PAGE_SIZES.a4).toEqual({ w: 900, h: 1273 })
  })

  it('both sizes share the same viewport width', () => {
    expect(PAGE_SIZES.letter.w).toBe(PAGE_SIZES.a4.w)
  })

  it('a4 is taller than letter', () => {
    expect(PAGE_SIZES.a4.h).toBeGreaterThan(PAGE_SIZES.letter.h)
  })
})

describe('PAGE_SIZES_PT', () => {
  it('letter has correct PDF point dimensions', () => {
    expect(PAGE_SIZES_PT.letter).toEqual([612, 792])
  })

  it('a4 has correct PDF point dimensions', () => {
    expect(PAGE_SIZES_PT.a4).toEqual([595, 842])
  })

  it('a4 is narrower but taller than letter in PDF points', () => {
    const [letterW, letterH] = PAGE_SIZES_PT.letter
    const [a4W, a4H] = PAGE_SIZES_PT.a4
    expect(a4W).toBeLessThan(letterW)
    expect(a4H).toBeGreaterThan(letterH)
  })
})
