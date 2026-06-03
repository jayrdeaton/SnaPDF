import type { CookieParam, Page } from 'puppeteer'
import puppeteer from 'puppeteer'

import { type PageSizeKey } from './constants'

export type { CookieParam }

export interface FetchOptions {
  pageSize?: PageSizeKey
  margin?: number
  landscape?: boolean
  timeout?: number
  cookies?: CookieParam[]
  selector?: string
  executablePath?: string
  args?: string[]
  onProgress?: (message: string) => void
  hideUserInput?: boolean
  hideAssistantOutput?: boolean
}

type PageWindow = Window &
  typeof globalThis & {
    __nodes: string[]
    __seenIds: Set<string>
    __stopObserver: () => void
  }

type Platform = 'chatgpt' | 'claude' | 'generic'

const noop = () => {}

const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const setupStealth = async (page: Page): Promise<void> => {
  await page.setUserAgent(CHROME_UA)
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    ;(window as Window & typeof globalThis & { chrome: unknown }).chrome = {
      app: {},
      csi: () => {},
      loadTimes: () => {},
      runtime: {},
    }
  })
}

const waitForCloudflare = async (page: Page, timeout: number): Promise<void> => {
  const deadline = Date.now() + Math.min(timeout, 20000)
  while (Date.now() < deadline) {
    const title = await page.title().catch(() => '')
    if (!/just a moment/i.test(title)) return
    await new Promise((r) => setTimeout(r, 1000))
  }
}

const CHATGPT_WAIT_SELECTOR = '[data-message-author-role], .text-message, article'
const CHATGPT_MSG_SELECTOR = '[data-message-author-role]'
const CLAUDE_SELECTOR = '[data-test-render-count]'

const detectPlatform = (url: string): Platform => {
  if (/claude\.ai/i.test(url)) return 'claude'
  if (/chatgpt\.com/i.test(url)) return 'chatgpt'
  return 'generic'
}

const getSelectors = (platform: Platform, customSelector?: string) => ({
  msgSelector: customSelector ?? (platform === 'claude' ? CLAUDE_SELECTOR : CHATGPT_MSG_SELECTOR),
  waitSelector: customSelector ?? (platform === 'claude' ? CLAUDE_SELECTOR : CHATGPT_WAIT_SELECTOR),
})

export const fetchTxt = async (url: string, options: FetchOptions = {}): Promise<string> => {
  const { onProgress = noop, executablePath, args, timeout = 60000, cookies, selector, hideUserInput = false, hideAssistantOutput = false } = options
  const platform = detectPlatform(url)
  const { msgSelector, waitSelector } = getSelectors(platform, selector)

  const browser = await puppeteer.launch({ headless: true, executablePath, args: ['--disable-blink-features=AutomationControlled', ...(args ?? [])] })
  try {
    const page = await browser.newPage()
    await setupStealth(page)
    await page.setViewport({ width: 1280, height: 900 })
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])

    if (cookies?.length) await page.setCookie(...cookies)

    onProgress('Loading page')
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout })
    await waitForCloudflare(page, timeout)
    if (platform === 'claude') await page.waitForNetworkIdle({ idleTime: 1000, timeout: 15000 }).catch(() => {})

    onProgress('Waiting for content')
    await page.waitForSelector(waitSelector, { timeout: Math.min(15000, timeout) }).catch(() => {})

    onProgress('Dismissing cookie banner')
    await page
      .evaluate(() => {
        const rejectPatterns = /reject|decline|necessary only|essential only|refuse/i
        const buttons = Array.from(document.querySelectorAll('button, a[role="button"]')) as HTMLElement[]
        const btn = buttons.find((el) => rejectPatterns.test(el.innerText))
        if (btn) btn.click()
      })
      .catch(() => {})
    await new Promise((r) => setTimeout(r, 500))

    onProgress('Scrolling to render lazy content')
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

    onProgress('Extracting text')
    const text = await page.evaluate(
      (sel, hideUser, hideAssistant, plt) => {
        const turns = document.querySelectorAll(sel)
        if (turns.length > 0) {
          return Array.from(turns)
            .map((el) => {
              const clone = el.cloneNode(true) as Element
              clone.querySelectorAll('.sr-only, button, [role="button"]').forEach((n) => n.remove())
              let role: string | null = null
              if (plt === 'claude') {
                role = clone.querySelector('[data-is-streaming]') !== null ? 'assistant' : 'user'
              } else {
                role = el.getAttribute('data-message-author-role')
              }
              if (hideUser && role === 'user') return null
              if (hideAssistant && role !== 'user') return null
              if (role) {
                const label = role === 'user' ? 'USER' : 'ASSISTANT'
                return `[${label}]\n${clone.textContent?.trim() ?? ''}`
              }
              return clone.textContent?.trim() ?? ''
            })
            .filter(Boolean)
            .join('\n\n---\n\n')
        }
        return document.body.innerText
      },
      msgSelector,
      hideUserInput,
      hideAssistantOutput,
      platform
    )

    return text
  } finally {
    await browser.close()
  }
}

export interface FetchResult {
  buffer: Buffer
  title: string
}

export const fetchPdf = async (url: string, options: FetchOptions = {}): Promise<FetchResult> => {
  const { pageSize = 'letter', margin = 36, landscape = false, onProgress = noop, executablePath, args, timeout = 60000, cookies, selector, hideUserInput = false, hideAssistantOutput = false } = options
  const marginIn = margin / 72
  const pageSizeFmt = pageSize === 'a4' ? 'A4' : 'Letter'
  const platform = detectPlatform(url)
  const { msgSelector, waitSelector } = getSelectors(platform, selector)

  const browser = await puppeteer.launch({ headless: true, executablePath, args: ['--disable-blink-features=AutomationControlled', ...(args ?? [])] })
  try {
    const page = await browser.newPage()
    await setupStealth(page)
    await page.setViewport({ width: 1280, height: 900 })
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])

    if (cookies?.length) await page.setCookie(...cookies)

    onProgress('Loading page')
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout })
    await waitForCloudflare(page, timeout)
    if (platform === 'claude') await page.waitForNetworkIdle({ idleTime: 1000, timeout: 15000 }).catch(() => {})

    onProgress('Waiting for content')
    await page.waitForSelector(waitSelector, { timeout: Math.min(15000, timeout) }).catch(() => {})

    onProgress('Dismissing cookie banner')
    await page
      .evaluate(() => {
        const rejectPatterns = /reject|decline|necessary only|essential only|refuse/i
        const buttons = Array.from(document.querySelectorAll('button, a[role="button"]')) as HTMLElement[]
        const btn = buttons.find((el) => rejectPatterns.test(el.innerText))
        if (btn) btn.click()
      })
      .catch(() => {})
    await new Promise((r) => setTimeout(r, 500))

    const pageTitle = await (async () => {
      if (platform === 'claude') {
        const title = await page.evaluate(() => {
          const lines = document.body.innerText.split('\n').map((l) => l.trim()).filter(Boolean)
          const first = lines[0] ?? ''
          return /shared by|this is a copy|you said|claude responded/i.test(first) ? '' : first
        }).catch(() => '')
        if (title) return title
      }
      return page.title()
    })()

    onProgress('Hiding fixed UI chrome')
    await page.addStyleTag({
      content: `
        *:not(script):not(style) { transition: none !important; animation: none !important; }
        [style*="position: fixed"], [style*="position:fixed"] { display: none !important; }
        * { scrollbar-width: none !important; }
        *::-webkit-scrollbar, *::-webkit-scrollbar-track, *::-webkit-scrollbar-thumb { display: none !important; }
        *::before, *::after { background: transparent !important; background-image: none !important; border: none !important; box-shadow: none !important; }
      `
    })
    await page.evaluate(() => {
      document.querySelectorAll<HTMLElement>('*').forEach((el) => {
        const { position } = getComputedStyle(el)
        if (position === 'fixed' || position === 'sticky') el.style.setProperty('display', 'none', 'important')
      })
    })

    await page
      .evaluate(() => {
        const pattern = /this is a copy of a shared/i
        document.querySelectorAll<HTMLElement>('div, section, aside, header').forEach((el) => {
          const text = el.innerText?.trim() ?? ''
          if (text.length < 200 && pattern.test(text)) el.style.setProperty('display', 'none', 'important')
        })
      })
      .catch(() => {})

    onProgress('Finding scroll container')
    const containerHandle = await page.evaluateHandle((sel) => {
      const firstMsg = document.querySelector(sel)
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
    }, msgSelector)

    // Hide scrollbars on the scroll container itself before any capture
    await page.evaluate((el) => {
      el.style.setProperty('scrollbar-width', 'none', 'important')
      ;(el as HTMLElement).style.setProperty('-ms-overflow-style', 'none', 'important')
    }, containerHandle)

    onProgress('Scrolling to load all content')
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

    onProgress('Expanding collapsed content')
    // Scroll back to top so viewport-gated buttons are reachable
    await page.evaluate((el) => {
      el.scrollTop = 0
    }, containerHandle)
    await new Promise((r) => setTimeout(r, 500))

    let expandCount = 0
    for (let pass = 0; pass < 8; pass++) {
      const clicked = await page.evaluate(() => {
        const pattern = /show\s+more|see\s+more|load\s+more|read\s+more|show\s+full/i
        let count = 0
        document.querySelectorAll<HTMLElement>('button, [role="button"], a, span[tabindex]').forEach((el) => {
          const text = (el.innerText ?? el.textContent ?? '').trim()
          if (pattern.test(text)) {
            el.scrollIntoView({ block: 'center' })
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
            count++
          }
        })
        return count
      })
      expandCount += clicked
      await new Promise((r) => setTimeout(r, 1000))
      if (clicked === 0) break
    }
    if (expandCount > 0) onProgress(`Expanded ${expandCount} collapsed section(s)`)

    // Remove "Show less" buttons left behind after expansion
    await page.evaluate(() => {
      const pattern = /show\s+less|see\s+less|collapse/i
      document.querySelectorAll<HTMLElement>('button, [role="button"], a, span[tabindex]').forEach((el) => {
        const text = (el.innerText ?? el.textContent ?? '').trim()
        if (pattern.test(text)) el.remove()
      })
    })

    // Strip Claude action bars (copy, share, thumbs up/down icons below each turn)
    if (platform === 'claude') {
      await page.evaluate(() => {
        document.querySelectorAll<HTMLElement>('[data-test-render-count] button, [data-test-render-count] [role="button"]').forEach((el) => el.remove())
      }).catch(() => {})
    }

    await page.evaluate((el) => {
      el.scrollTop = 0
    }, containerHandle)
    await new Promise((r) => setTimeout(r, 800))

    onProgress('Attaching node accumulator')
    await page.evaluate((sel) => {
      ;(window as PageWindow).__nodes = [] as string[]
      ;(window as PageWindow).__seenIds = new Set<string>()

      const capture = (el: Element) => {
        const id = el.getAttribute('data-message-id') ?? el.getAttribute('id') ?? null
        const key = id ?? `__pos_${(window as PageWindow).__nodes.length}`
        if ((window as PageWindow).__seenIds.has(key)) return
        ;(window as PageWindow).__seenIds.add(key)
        ;(window as PageWindow).__nodes.push(el.outerHTML)
      }

      document.querySelectorAll(sel).forEach(capture)

      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          m.addedNodes.forEach((node) => {
            if (!(node instanceof Element)) return
            if (node.matches(sel)) {
              capture(node)
            } else {
              node.querySelectorAll(sel).forEach(capture)
            }
          })
        }
      })

      observer.observe(document.body, { childList: true, subtree: true })
      ;(window as PageWindow).__stopObserver = () => observer.disconnect()
    }, msgSelector)

    onProgress('Scrolling to collect all nodes')
    prevH = 0
    stableCount = 0
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

    const nodeCount = await page.evaluate(() => (window as PageWindow).__nodes.length)
    onProgress(`Collected ${nodeCount} message nodes`)
    if (nodeCount === 0) throw new Error('No content found — the page may have blocked the request, or use --selector to specify the right CSS selector')

    const { nodesJson, stylesheetsJson } = await page.evaluate(() => {
      ;(window as PageWindow).__stopObserver()

      const sheets: string[] = []
      document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]').forEach((l) => {
        if (l.href) sheets.push(JSON.stringify({ type: 'link', href: l.href }))
      })
      document.querySelectorAll('style').forEach((s) => {
        if (s.textContent) sheets.push(JSON.stringify({ type: 'inline', content: s.textContent }))
      })

      return {
        nodesJson: JSON.stringify((window as PageWindow).__nodes),
        stylesheetsJson: JSON.stringify(sheets)
      }
    })

    const nodes: string[] = JSON.parse(nodesJson)
    const sheetDefs: Array<{ type: string; href?: string; content?: string }> = (JSON.parse(stylesheetsJson) as string[]).map((s) => JSON.parse(s))

    const styleInjections = sheetDefs.map((s) => (s.type === 'link' ? `<link rel="stylesheet" href="${s.href}">` : `<style>${s.content}</style>`)).join('\n')

    const userSel = platform === 'claude' ? '[data-test-render-count]:not(:has([data-is-streaming]))' : '[data-message-author-role="user"]'
    const aiSel = platform === 'claude' ? '[data-test-render-count]:has([data-is-streaming])' : '[data-message-author-role="assistant"]'

    const staticHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
${styleInjections}
<style>
  @media print {
    @page {
      size: ${pageSizeFmt} ${landscape ? 'landscape' : 'portrait'};
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
  .sr-only { display: none !important; }
  * { scrollbar-width: none !important; }
  *::-webkit-scrollbar, *::-webkit-scrollbar-track, *::-webkit-scrollbar-thumb { display: none !important; width: 0 !important; }
  *::before, *::after {
    background: transparent !important;
    background-image: none !important;
    border: none !important;
    box-shadow: none !important;
    outline: none !important;
  }
  html, body {
    border: none !important;
    outline: none !important;
    box-shadow: none !important;
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
  ${userSel} {
    padding-bottom: 28px !important;
  }
  ${hideUserInput ? `${userSel} { display: none !important; }` : ''}
  ${hideAssistantOutput ? `${aiSel} { display: none !important; }` : ''}
</style>
</head>
<body>
<div class="pdfetch-container">
${nodes.join('\n')}
</div>
</body>
</html>`

    onProgress('Rendering static page')
    const browser2 = await puppeteer.launch({ headless: true, executablePath, args })
    try {
      const printPage = await browser2.newPage()
      await printPage.setContent(staticHtml, { waitUntil: 'domcontentloaded', timeout })
      await new Promise((r) => setTimeout(r, 1000))

      onProgress('Printing PDF')
      const pdfBuffer = await printPage.pdf({
        format: pageSizeFmt as 'Letter' | 'A4',
        landscape,
        margin: {
          top: `${marginIn}in`,
          bottom: `${marginIn}in`,
          left: `${marginIn}in`,
          right: `${marginIn}in`
        },
        printBackground: true
      })

      return { buffer: Buffer.from(pdfBuffer), title: pageTitle }
    } finally {
      await browser2.close()
    }
  } finally {
    await browser.close()
  }
}
