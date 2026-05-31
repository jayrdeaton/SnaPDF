import cosmeticLib from 'cosmetic'
import fs from 'fs/promises'
import ora from 'ora'
import path from 'path'
import { command } from 'termkit'

import { type PageSizeKey } from './constants'
import { fetchPdf, fetchTxt } from './fetch'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cosmetic = cosmeticLib as any

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
  command('pdfetch', '<url> [output]')
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

      const spinner = ora(cosmetic.faint('Launching browser')).start()

      const onProgress = (msg: string) => {
        spinner.text = cosmetic.faint(msg)
      }

      if (txtMode) {
        const text = await fetchTxt(url, { onProgress, timeout, cookies: undefined, selector }).catch((err) => {
          spinner.fail(cosmetic.red(String(err)))
          process.exit(1)
        })

        const dest = await resolveOutputPath(outFile ?? 'output.txt')
        spinner.text = `Saving to ${cosmetic.cyan(dest)}`
        await fs.writeFile(dest, text, 'utf8')
        spinner.succeed(`Saved to ${cosmetic.underline.cyan(dest)}`)
      } else {
        const pdf = await fetchPdf(url, { pageSize, margin, landscape, timeout, selector, onProgress }).catch((err) => {
          spinner.fail(cosmetic.red(String(err)))
          process.exit(1)
        })

        const dest = await resolveOutputPath(outFile ?? 'output.pdf')
        spinner.text = `Saving to ${cosmetic.cyan(dest)}`
        await fs.writeFile(dest, pdf)
        spinner.succeed(`Saved to ${cosmetic.underline.cyan(dest)}`)
      }
    })
