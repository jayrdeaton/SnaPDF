/* eslint-disable no-console */
import cosmeticLib from 'cosmetic'
import fs from 'fs/promises'
import path from 'path'
import ora from 'ora'
import { PDFDocument } from 'pdf-lib'
import puppeteer from 'puppeteer'
import { command } from 'termkit'

import { PAGE_SIZES, PAGE_SIZES_PT, type PageSizeKey } from './constants'

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
    .option('t', 'txt', null, 'Dump plain text instead of saving a PDF')
    .option('p', 'page-size', '[size]', 'Page size: a4 or letter (default: letter)')
    .option('m', 'margin', '[pt]', 'PDF margin in points — 72pt = 1 in (default: 36)')
    .action(async (options) => {
      const url = options.url as string
      const outFile = options.output as string | undefined
      const txtMode = Boolean(options.txt)
      const rawSize = (typeof options['page-size'] === 'string' ? options['page-size'] : 'letter').toLowerCase()
      const pageSizeArg: PageSizeKey = rawSize in PAGE_SIZES ? (rawSize as PageSizeKey) : 'letter'
      const marginPt = Math.max(0, Number(typeof options.margin === 'string' ? options.margin : 36) || 36)

      const { w: VIEWPORT_W, h: PAGE_H } = PAGE_SIZES[pageSizeArg]
      // Use a taller browser viewport than one page so the virtual scroll always
      // keeps the next page's content rendered (lookahead). We still advance and
      // screenshot at PAGE_H increments for correct page sizing.
      const VIEWPORT_H = PAGE_H * 3

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
      await page.setViewport({ width: VIEWPORT_W, height: VIEWPORT_H })
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

        if (outFile) {
          const txtDest = await resolveOutputPath(outFile)
          spinner.text = `Saving to ${cosmetic.cyan(txtDest)}`
          await fs.writeFile(txtDest, text, 'utf8')
          spinner.succeed(`Saved to ${cosmetic.underline.cyan(txtDest)}`)
        } else {
          spinner.stop()
          console.log(text)
        }
      } else {
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
            const pattern = /this is a copy of a shared|report conversation/i
            document.querySelectorAll<HTMLElement>('div, section, aside, header').forEach((el) => {
              const text = el.innerText?.trim() ?? ''
              if (text.length < 200 && pattern.test(text)) el.style.setProperty('display', 'none', 'important')
            })
          })
          .catch(() => {})

        spinner.text = cosmetic.faint('Finding scroll container')
        const containerHandle = await page.evaluateHandle(() => {
          // Walk up from the first message element to find its scrollable ancestor.
          // More reliable than searching by scrollHeight, which can pick the wrong
          // container after fixed elements are hidden and the DOM reflows.
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

        const { scrollHeight, offsetTop, offsetLeft } = await page.evaluate(
          (el) => ({
            scrollHeight: el.scrollHeight,
            offsetTop: el.getBoundingClientRect().top,
            offsetLeft: el.getBoundingClientRect().left
          }),
          containerHandle
        )

        // Pre-scroll to the bottom so the virtual scroll loads all content, then
        // record the stable total height as a reliable loop bound.
        spinner.text = cosmetic.faint('Measuring content length')
        let prevH = 0
        let stableCount = 0
        while (stableCount < 4) {
          await page.evaluate((el) => {
            el.scrollTop = el.scrollHeight
          }, containerHandle)
          await new Promise((r) => setTimeout(r, 1500))
          const h = await page.evaluate((el) => el.scrollHeight, containerHandle)
          if (h === prevH) stableCount++
          else {
            stableCount = 0
            prevH = h
          }
        }
        // One final scroll-to-bottom with a longer wait to catch any tail content
        // that only renders when the scroll position is near the end.
        await page.evaluate((el) => { el.scrollTop = el.scrollHeight }, containerHandle)
        await new Promise((r) => setTimeout(r, 2500))
        const tailH = await page.evaluate((el) => el.scrollHeight, containerHandle)
        let totalScrollHeight = Math.max(prevH, tailH)
        const totalPages = Math.ceil(totalScrollHeight / PAGE_H)
        spinner.text = `Content measured — ${cosmetic.yellow(String(totalPages))} pages`

        // Scroll back to top. With VIEWPORT_H = 3×PAGE_H the virtual scroll keeps
        // 3 pages of content rendered at all times, so the next page is always
        // already rendered before we need to screenshot it.
        await page.evaluate((el) => {
          el.scrollTop = 0
        }, containerHandle)
        await new Promise((r) => setTimeout(r, 1200))

        // Measure actual chat content column width from the first visible messages.
        // The full viewport may have empty whitespace to the right of the content column
        // (e.g. ChatGPT's max-width thread inside a full-width scroll container).
        // Clipping to the true content right edge ensures screenshots fill the PDF width.
        const contentRight = await page.evaluate(() => {
          const msgs = Array.from(document.querySelectorAll('[data-message-author-role]')).slice(0, 5)
          if (msgs.length === 0) return 0
          let maxR = 0
          for (const msg of msgs) {
            const r = msg.getBoundingClientRect()
            if (r.right > maxR) maxR = r.right
          }
          return Math.ceil(maxR)
        })
        const effectiveW = contentRight > 100 ? Math.min(contentRight, VIEWPORT_W) : VIEWPORT_W
        // Narrow the per-page capture height proportionally to the width reduction so
        // that when the screenshot is scaled to fill CONTENT_W_PT the resulting height
        // is identical to the original and always fits within the PDF page.
        const effectivePageH = Math.round(PAGE_H * (effectiveW / VIEWPORT_W))
        const effectiveTotalPages = Math.ceil(totalScrollHeight / effectivePageH)

        // Re-measure container position after all pre-processing has settled.
        // The initial measurement (before the pre-scroll) can be stale: light-mode
        // layouts may reflow after the sticky/fixed chrome is hidden and the virtual
        // scroll fully loads, shifting offsetTop by tens of pixels and causing the
        // first page to clip below the actual top of the conversation.
        const { offsetTop: captureOffsetTop, offsetLeft: captureOffsetLeft } = await page.evaluate(
          (el) => ({
            offsetTop: el.getBoundingClientRect().top,
            offsetLeft: el.getBoundingClientRect().left
          }),
          containerHandle
        )

        const SEAM_OVERLAP_PX = 32
        const screenshots: Uint8Array[] = []
        let docStart = 0
        let pageNum = 0

        while (docStart < totalScrollHeight) {
          pageNum++
          const remaining = totalScrollHeight - docStart
          const captureHeight = Math.round(Math.min(effectivePageH, remaining))

          spinner.text = `Capturing page ${cosmetic.yellow(String(pageNum))} of ${cosmetic.yellow(String(effectiveTotalPages))}`

          // Scroll to 200px before docStart so actualTop is always <= docStart.
          // This guarantees the clip y-offset (docStart - actualTop) is non-negative,
          // preventing the scroll engine's overshoot from silently dropping seam content.
          await page.evaluate(
            (el, top) => {
              el.scrollTop = top
            },
            containerHandle,
            Math.max(0, docStart - 200)
          )
          await new Promise((r) => setTimeout(r, 300))
          const actualTop = await page.evaluate((el) => el.scrollTop, containerHandle)

          const clipOpts = {
            x: Math.max(0, captureOffsetLeft),
            y: Math.max(0, captureOffsetTop + (docStart - actualTop)),
            width: Math.max(1, effectiveW - Math.max(0, captureOffsetLeft)),
            height: Math.max(1, captureHeight)
          }

          let shot = await page.screenshot({ type: 'png', clip: clipOpts })

          const isBlank = (s: Uint8Array) => s.length < 30000 && captureHeight > effectivePageH * 0.5
          let retries = 0
          while (isBlank(shot) && retries < 4) {
            retries++
            spinner.text = `Capturing page ${cosmetic.yellow(String(pageNum))} of ${cosmetic.yellow(String(effectiveTotalPages))} ${cosmetic.faint(`(retry ${retries})`)}`
            await new Promise((r) => setTimeout(r, 1500))
            shot = await page.screenshot({ type: 'png', clip: clipOpts })
          }

          // Re-read live scrollHeight each iteration — content may load beyond the
          // pre-measured bound as the virtual scroll catches up during capture.
          // Cap at 130% of the original to prevent runaway.
          const live = await page.evaluate((el) => el.scrollHeight, containerHandle)
          if (live > totalScrollHeight && live <= totalScrollHeight * 1.3) {
            totalScrollHeight = live
          }

          if (!isBlank(shot)) screenshots.push(shot)

          // Advance by one page minus the seam overlap so the next page starts
          // SEAM_OVERLAP_PX before this page's bottom, preventing text from being
          // sliced at boundaries. When advance <= 0 the remaining content is entirely
          // within the overlap already shown, so we're done.
          const seamOverlap = pageNum === 1 ? 0 : SEAM_OVERLAP_PX
          const advance = captureHeight - seamOverlap
          if (advance <= 0) break
          docStart += advance
        }

        await browser.close()

        spinner.text = cosmetic.faint('Assembling PDF')
        const pdfDoc = await PDFDocument.create()

        // Standard page dimensions in PDF points (72pt = 1 inch)
        const [PAGE_W_PT, PAGE_H_PT] = PAGE_SIZES_PT[pageSizeArg]
        const MARGIN_PT = marginPt
        const CONTENT_W_PT = PAGE_W_PT - MARGIN_PT * 2
        const CONTENT_H_PT = PAGE_H_PT - MARGIN_PT * 2

        for (const shot of screenshots) {
          if (shot.length < 10000) continue
          const img = await pdfDoc.embedPng(shot)
          const { width, height } = img.scale(1)
          // Scale to fit within the content box, preserving aspect ratio.
          const scale = Math.min(CONTENT_W_PT / width, CONTENT_H_PT / height)
          const scaledW = width * scale
          const scaledH = height * scale
          // Center within the content box so margins are equal on all sides.
          const pdfPage = pdfDoc.addPage([PAGE_W_PT, PAGE_H_PT])
          pdfPage.drawImage(img, {
            x: MARGIN_PT + (CONTENT_W_PT - scaledW) / 2,
            y: MARGIN_PT + (CONTENT_H_PT - scaledH) / 2,
            width: scaledW,
            height: scaledH
          })
        }

        spinner.text = cosmetic.faint('Writing PDF')
        const dest = await resolveOutputPath(outFile ?? 'output.pdf')
        await fs.writeFile(dest, await pdfDoc.save())
        spinner.succeed(`Saved to ${cosmetic.underline.cyan(dest)}`)
      }
    })
