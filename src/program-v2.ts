/* eslint-disable no-console */
import cosmeticLib from 'cosmetic'
import fs from 'fs/promises'
import path from 'path'
import ora from 'ora'
import puppeteer from 'puppeteer'
import { command } from 'termkit'

import { type PageSizeKey } from './constants'

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
    .action(async (options) => {
      const url = options.url as string
      const outFile = options.output as string | undefined
      const txtMode = Boolean(options.txt)
      const rawSize = (typeof options['page-size'] === 'string' ? options['page-size'] : 'letter').toLowerCase()
      const pageSizeArg: PageSizeKey = rawSize in { letter: 1, a4: 1 } ? (rawSize as PageSizeKey) : 'letter'
      const marginPt = Math.max(0, Number(typeof options.margin === 'string' ? options.margin : 36) || 36)

      const spinner = ora(cosmetic.faint('Launching browser')).start()

      const browser = await puppeteer.launch({
        headless: true,
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false
      })

      process.on('SIGINT', () => {
        spinner.fail(cosmetic.red('Cancelled'))
        try {
          browser.process()?.kill('SIGKILL')
        } catch {}
        process.exit(1)
      })

      const page = await browser.newPage()
      await page.setViewport({ width: 1280, height: 900 })
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])

      spinner.text = `Loading ${cosmetic.cyan(url)}`
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })

      spinner.text = cosmetic.faint('Waiting for content')
      await page.waitForSelector('[data-message-author-role], .text-message, article', { timeout: 15000 }).catch(() => {})

      spinner.text = cosmetic.faint('Dismissing cookie banner')
      await page
        .evaluate(() => {
          const rejectPatterns = /reject|decline|necessary only|essential only|refuse/i
          const buttons = Array.from(document.querySelectorAll('button, a[role="button"]')) as HTMLElement[]
          const btn = buttons.find((el) => rejectPatterns.test(el.innerText))
          if (btn) btn.click()
        })
        .catch(() => {})
      await new Promise((r) => setTimeout(r, 500))

      if (txtMode) {
        spinner.text = cosmetic.faint('Scrolling to render lazy content')
        await page.evaluate(async () => {
          const all = Array.from(document.querySelectorAll('*'))
          let container: Element = document.documentElement
          for (const el of all.reverse()) {
            const { overflowY, overflow } = getComputedStyle(el)
            if ((overflowY === 'auto' || overflowY === 'scroll' || overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight + 10) {
              container = el
              break
            }
          }
          await new Promise<void>((resolve) => {
            const timer = setInterval(() => {
              container.scrollBy(0, 600)
              if (container.scrollTop + container.clientHeight >= container.scrollHeight - 10) {
                clearInterval(timer)
                container.scrollTop = 0
                resolve()
              }
            }, 120)
          })
        })
        await new Promise((r) => setTimeout(r, 1500))

        spinner.text = cosmetic.faint('Extracting text')
        const text = await page.evaluate(() => {
          const turns = document.querySelectorAll('[data-message-author-role]')
          if (turns.length > 0) {
            return Array.from(turns)
              .map((el) => {
                const role = el.getAttribute('data-message-author-role') ?? 'unknown'
                const label = role === 'user' ? 'USER' : 'ASSISTANT'
                return `[${label}]\n${el.textContent?.trim() ?? ''}`
              })
              .join('\n\n---\n\n')
          }
          const articles = document.querySelectorAll('article')
          if (articles.length > 0) {
            return Array.from(articles)
              .map((el) => el.textContent?.trim() ?? '')
              .join('\n\n---\n\n')
          }
          return document.body.innerText
        })

        await browser.close()

        const txtDest = await resolveOutputPath(outFile ?? 'output.txt')
        spinner.text = `Saving to ${cosmetic.cyan(txtDest)}`
        await fs.writeFile(txtDest, text, 'utf8')
        spinner.succeed(`Saved to ${cosmetic.underline.cyan(txtDest)}`)
        return
      }

      // --- PDF path: accumulate DOM nodes via MutationObserver as virtual scroll renders them ---

      spinner.text = cosmetic.faint('Hiding fixed UI chrome')
      await page.addStyleTag({
        content: `
          *:not(script):not(style) { transition: none !important; animation: none !important; }
          [style*="position: fixed"], [style*="position:fixed"] { display: none !important; }
        `
      })
      await page.evaluate(() => {
        document.querySelectorAll<HTMLElement>('*').forEach((el) => {
          const { position } = getComputedStyle(el)
          if (position === 'fixed' || position === 'sticky') el.style.setProperty('display', 'none', 'important')
        })
      })

      spinner.text = cosmetic.faint('Removing shared-page banners')
      await page
        .evaluate(() => {
          const pattern = /this is a copy of a shared/i
          document.querySelectorAll<HTMLElement>('div, section, aside, header').forEach((el) => {
            const text = el.innerText?.trim() ?? ''
            if (text.length < 200 && pattern.test(text)) el.style.setProperty('display', 'none', 'important')
          })
        })
        .catch(() => {})

      spinner.text = cosmetic.faint('Finding scroll container')
      const containerHandle = await page.evaluateHandle(() => {
        const firstMsg = document.querySelector('[data-message-author-role]')
        if (firstMsg) {
          let el = firstMsg.parentElement
          while (el && el !== document.documentElement) {
            const { overflowY, overflow } = getComputedStyle(el)
            if ((overflowY === 'auto' || overflowY === 'scroll' || overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight) {
              return el
            }
            el = el.parentElement
          }
        }
        return document.documentElement
      })

      // Snap to the top first so that if the page loaded at the bottom (some chat
      // UIs do this), the initial capture starts at message #1, not the last message.
      await page.evaluate((el) => { el.scrollTop = 0 }, containerHandle)
      await new Promise((r) => setTimeout(r, 800))

      spinner.text = cosmetic.faint('Attaching node accumulator')

      // Inject the accumulator and MutationObserver. Initial capture happens here
      // (after we've snapped to top) so node order == document order from the start.
      await page.evaluate(() => {
        ;(window as any).__nodes = [] as string[]
        ;(window as any).__seenIds = new Set<string>()

        const msgSelector = '[data-message-author-role]'

        const capture = (el: Element) => {
          const id = el.getAttribute('data-message-id') ?? el.getAttribute('id') ?? null
          const key = id ?? `__pos_${(window as any).__nodes.length}`
          if ((window as any).__seenIds.has(key)) return
          ;(window as any).__seenIds.add(key)
          ;(window as any).__nodes.push(el.outerHTML)
        }

        // Capture nodes currently visible at the top
        document.querySelectorAll(msgSelector).forEach(capture)

        // Watch for nodes added by virtual scroll as we scroll down
        const observer = new MutationObserver((mutations) => {
          for (const m of mutations) {
            m.addedNodes.forEach((node) => {
              if (!(node instanceof Element)) return
              if (node.matches(msgSelector)) {
                capture(node)
              } else {
                node.querySelectorAll(msgSelector).forEach(capture)
              }
            })
          }
        })

        observer.observe(document.body, { childList: true, subtree: true })
        ;(window as any).__stopObserver = () => observer.disconnect()
      })

      // Scroll down until scrollHeight is stable — this forces virtual scroll to
      // render every node in order. We only scroll down, never up, so capture order
      // matches document order.
      spinner.text = cosmetic.faint('Scrolling to load all content')
      let prevH = 0
      let stableCount = 0
      while (stableCount < 3) {
        await page.evaluate((el) => {
          el.scrollTop = el.scrollHeight
        }, containerHandle)
        await new Promise((r) => setTimeout(r, 1000))
        const h = await page.evaluate((el) => el.scrollHeight, containerHandle)
        if (h === prevH) stableCount++
        else {
          stableCount = 0
          prevH = h
        }
      }

      const nodeCount = await page.evaluate(() => (window as any).__nodes.length)
      spinner.text = `Collected ${cosmetic.yellow(String(nodeCount))} message nodes`
      await new Promise((r) => setTimeout(r, 300))

      // Stop observing and grab captured HTML + all stylesheets from the source page.
      const { nodesJson, stylesheetsJson } = await page.evaluate(() => {
        ;(window as any).__stopObserver()

        const sheets: string[] = []
        document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]').forEach((l) => {
          if (l.href) sheets.push(JSON.stringify({ type: 'link', href: l.href }))
        })
        document.querySelectorAll('style').forEach((s) => {
          if (s.textContent) sheets.push(JSON.stringify({ type: 'inline', content: s.textContent }))
        })

        return {
          nodesJson: JSON.stringify((window as any).__nodes),
          stylesheetsJson: JSON.stringify(sheets)
        }
      })

      await browser.close()

      // Build a static page with all collected nodes and source styles, then print it.
      const nodes: string[] = JSON.parse(nodesJson)
      const sheetDefs: Array<{ type: string; href?: string; content?: string }> = (JSON.parse(stylesheetsJson) as string[]).map((s) => JSON.parse(s))

      const marginIn = marginPt / 72
      const pageSize = pageSizeArg === 'a4' ? 'A4' : 'letter'

      const styleInjections = sheetDefs
        .map((s) => (s.type === 'link' ? `<link rel="stylesheet" href="${s.href}">` : `<style>${s.content}</style>`))
        .join('\n')

      const staticHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
${styleInjections}
<style>
  @media print {
    @page {
      size: ${pageSize};
      margin: ${marginIn}in;
    }
    html, body {
      width: 100%;
      height: auto;
      overflow: visible;
    }
    * {
      position: static !important;
      overflow: visible !important;
    }
  }
  body {
    margin: 0;
    padding: 0;
  }
  .pdfetch-container {
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  [data-message-author-role="user"] {
    padding-bottom: 28px !important;
  }
</style>
</head>
<body>
<div class="pdfetch-container">
${nodes.join('\n')}
</div>
</body>
</html>`

      spinner.text = cosmetic.faint('Rendering static page')
      const browser2 = await puppeteer.launch({ headless: true })
      const printPage = await browser2.newPage()

      await printPage.setContent(staticHtml, { waitUntil: 'networkidle0', timeout: 60000 })
      await new Promise((r) => setTimeout(r, 1000))

      spinner.text = cosmetic.faint('Printing PDF')
      const pdfBuffer = await printPage.pdf({
        format: pageSize as 'Letter' | 'A4',
        margin: {
          top: `${marginIn}in`,
          bottom: `${marginIn}in`,
          left: `${marginIn}in`,
          right: `${marginIn}in`
        },
        printBackground: true
      })

      await browser2.close()

      const dest = await resolveOutputPath(outFile ?? 'output.pdf')
      await fs.writeFile(dest, pdfBuffer)
      spinner.succeed(`Saved to ${cosmetic.underline.cyan(dest)}`)
    })
