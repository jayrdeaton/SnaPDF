jest.mock('puppeteer', () => ({
  __esModule: true,
  default: { launch: jest.fn() }
}))

jest.mock('termkit', () => ({
  __esModule: true,
  ...jest.requireActual('termkit'),
  Spinner: jest.fn().mockImplementation(() => ({
    start: jest.fn().mockReturnThis(),
    stop: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
  }))
}))

import { createProgram } from '../program'

describe('createProgram', () => {
  it('creates a command named snapdf', () => {
    const cmd = createProgram()
    expect(cmd.name).toBe('snapdf')
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

  it('has a -l/--landscape option', () => {
    const cmd = createProgram()
    const opt = cmd.optionsArray.find((o) => o.long === 'landscape')
    expect(opt).toBeDefined()
    expect(opt?.short).toBe('l')
  })

  it('has a -T/--timeout option', () => {
    const cmd = createProgram()
    const opt = cmd.optionsArray.find((o) => o.long === 'timeout')
    expect(opt).toBeDefined()
    expect(opt?.short).toBe('T')
  })

  it('has a -s/--selector option', () => {
    const cmd = createProgram()
    const opt = cmd.optionsArray.find((o) => o.long === 'selector')
    expect(opt).toBeDefined()
    expect(opt?.short).toBe('s')
  })

  it('has a -H/--hide-user-input option', () => {
    const cmd = createProgram()
    const opt = cmd.optionsArray.find((o) => o.long === 'hide-user-input')
    expect(opt).toBeDefined()
    expect(opt?.short).toBe('H')
  })

  it('has a -A/--hide-assistant-output option', () => {
    const cmd = createProgram()
    const opt = cmd.optionsArray.find((o) => o.long === 'hide-assistant-output')
    expect(opt).toBeDefined()
    expect(opt?.short).toBe('A')
  })

  it('has url and output positional variables', () => {
    const cmd = createProgram()
    const names = cmd.variables?.map((v) => v.name) ?? []
    expect(names).toContain('url')
    expect(names).toContain('output')
  })
})
