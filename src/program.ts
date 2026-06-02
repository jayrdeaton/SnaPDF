import cosmeticLib from 'cosmetic'
import fs from 'fs/promises'
import path from 'path'
import { command } from 'termkit'
import { Spinner } from 'termpulse'

import { type PageSizeKey } from './constants'
import { fetchPdf, type FetchResult, fetchTxt } from './fetch'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cosmetic = cosmeticLib as any

const titleToFilename = (title: string): string => {
  // Strip common site suffixes like " - Claude" or " | ChatGPT"
  const clean = title.replace(/\s*[-|]\s*(claude|chatgpt|openai|anthropic).*$/i, '').trim()
  if (!clean) return 'output'
  return clean
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

const resolveOutputPath = async (desired: string): Promise<string> => {
  try {
    await fs.access(desired)
  } catch {
    return desired
  }
  const ext = path.extname(desired)
  const base = desired.slice(0, desired.length - ext.length)
  let i = 1
  while (true) {
    const candidate = `${base}-${i}${ext}`
    try {
      await fs.access(candidate)
      i++
    } catch {
      return candidate
    }
  }
}

export const createProgram = () =>
  command('snapdf', '<url> [output]')
    .description('Scrape JavaScript-rendered pages to PDF or plain text')
    .option('t', 'txt', null, 'Save as a plain text file instead of PDF')
    .option('p', 'page-size', '[size]', 'PDF page size: a4 or letter (default: letter)')
    .option('m', 'margin', '[pt]', 'PDF margin in points — 72pt = 1 in (default: 36)')
    .option('l', 'landscape', null, 'PDF landscape orientation')
    .option('T', 'timeout', '[ms]', 'Page load timeout in milliseconds (default: 60000)')
    .option('s', 'selector', '[css]', 'CSS selector for message elements (default: ChatGPT)')
    .action(async (options) => {
      const url = options.url as string
      const outFile = options.output as string | undefined
      const txtMode = Boolean(options.txt)
      const rawSize = (typeof options['page-size'] === 'string' ? options['page-size'] : 'letter').toLowerCase()
      const pageSize: PageSizeKey = rawSize in { letter: 1, a4: 1 } ? (rawSize as PageSizeKey) : 'letter'
      const margin = Math.max(0, Number(typeof options.margin === 'string' ? options.margin : 36) || 36)
      const landscape = Boolean(options.landscape)
      const timeout = Number(typeof options.timeout === 'string' ? options.timeout : 60000) || 60000
      const selector = typeof options.selector === 'string' ? options.selector : undefined

      const ext = txtMode ? '.txt' : '.pdf'

      const spinner = new Spinner({ text: cosmetic.faint('Launching browser') })
      spinner.start()

      const onProgress = (msg: string) => {
        spinner.message(cosmetic.faint(msg))
      }

      if (txtMode) {
        const text = await fetchTxt(url, { onProgress, timeout, cookies: undefined, selector }).catch((err) => {
          spinner.fail(cosmetic.red(String(err))).stop()
          process.exit(1)
        })

        const normalizedOut = outFile ? (path.extname(outFile) ? outFile : `${outFile}${ext}`) : `output${ext}`
        const dest = await resolveOutputPath(normalizedOut)
        spinner.message(`Saving to ${cosmetic.cyan(dest)}`)
        await fs.writeFile(dest, text, 'utf8')
        spinner.succeed(`Saved to ${cosmetic.underline.cyan(dest)}`).stop()
      } else {
        const result = await fetchPdf(url, { pageSize, margin, landscape, timeout, selector, onProgress }).catch((err) => {
          spinner.fail(cosmetic.red(String(err))).stop()
          process.exit(1)
        })
        const { buffer: pdf, title } = result as FetchResult

        const defaultName = outFile ? (path.extname(outFile) ? outFile : `${outFile}${ext}`) : `${titleToFilename(title)}${ext}`
        const dest = await resolveOutputPath(defaultName)
        spinner.message(`Saving to ${cosmetic.cyan(dest)}`)
        await fs.writeFile(dest, pdf)
        spinner.succeed(`Saved to ${cosmetic.underline.cyan(dest)}`).stop()
      }
    })
