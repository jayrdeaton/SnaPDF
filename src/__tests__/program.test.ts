jest.mock('puppeteer', () => ({
  __esModule: true,
  default: { launch: jest.fn() }
}))

jest.mock('ora', () => ({
  __esModule: true,
  default: jest.fn(() => ({ start: jest.fn().mockReturnThis(), text: '' }))
}))

import { createProgram } from '../program'

describe('createProgram', () => {
  it('creates a command named pdfetch', () => {
    const cmd = createProgram()
    expect(cmd.name).toBe('pdfetch')
  })

  it('has a description', () => {
    const cmd = createProgram()
    expect(cmd.info).toBeTruthy()
  })

  it('has a -t/--txt option', () => {
    const cmd = createProgram()
    const opt = cmd.optionsArray.find((o) => o.long === 'txt')
    expect(opt).toBeDefined()
    expect(opt?.short).toBe('t')
  })

  it('has a -p/--page-size option', () => {
    const cmd = createProgram()
    const opt = cmd.optionsArray.find((o) => o.long === 'page-size')
    expect(opt).toBeDefined()
    expect(opt?.short).toBe('p')
  })

  it('has url and output positional variables', () => {
    const cmd = createProgram()
    const names = cmd.variables?.map((v) => v.name) ?? []
    expect(names).toContain('url')
    expect(names).toContain('output')
  })
})
