# snapdf

Convert JavaScript-rendered web pages to PDF or plain text. Built for sites with virtual scrolling (ChatGPT, Claude, etc.) where the browser's native print fails because content isn't all in the DOM at once.

Instead of screenshotting, snapdf scrolls through the page collecting DOM nodes as virtual scroll renders them, reassembles them into a static document, and prints it with Chrome's native PDF engine — giving you a real text-based, searchable PDF.

## Installation

```sh
npm install -g snapdf
```

## CLI

```sh
snapdf <url> [output]
```

### Options

| Flag | Description |
|------|-------------|
| `-t`, `--txt` | Save as plain text file instead of PDF |
| `-p`, `--page-size` | `letter` or `a4` (default: `letter`) |
| `-m`, `--margin` | Margin in points, 72pt = 1in (default: `36`) |
| `-l`, `--landscape` | Landscape orientation |
| `-T`, `--timeout` | Page load timeout in milliseconds (default: `60000`) |
| `-s`, `--selector` | CSS selector for message elements (default: ChatGPT) |

### Examples

```sh
# Save a ChatGPT shared conversation to PDF
snapdf https://chatgpt.com/share/abc123

# Custom output path
snapdf https://chatgpt.com/share/abc123 conversation.pdf

# Plain text
snapdf https://chatgpt.com/share/abc123 -t

# A4, 0.5in margins, landscape
snapdf https://chatgpt.com/share/abc123 -p a4 -m 36 -l

# Custom selector for other sites
snapdf https://example.com/thread -s "article.message"

# Longer timeout for slow pages
snapdf https://chatgpt.com/share/abc123 -T 120000
```

If no output path is given, the filename is derived from the page title (e.g. `crumby-app-discussion.pdf`). If a name is given without an extension, the correct one is added automatically (`conversation` → `conversation.pdf`). Existing files are never overwritten — snapdf increments the filename (`output-1.pdf`, `output-2.pdf`, etc.).

## Programmatic API

```sh
npm install snapdf
```

```ts
import { fetchPdf, fetchTxt, type FetchResult } from 'snapdf'
```

### `fetchPdf(url, options?): Promise<FetchResult>`

Returns `{ buffer: Buffer, title: string }`.

```ts
const { buffer, title } = await fetchPdf('https://chatgpt.com/share/abc123', {
  pageSize: 'letter',   // 'letter' | 'a4'
  margin: 36,           // points, 72pt = 1in
  landscape: false,
  timeout: 60000,       // ms
  selector: '[data-message-author-role]',
  cookies: [{ name: 'session', value: '...', domain: 'chatgpt.com' }],
  executablePath: '/path/to/chrome',
  args: ['--no-sandbox'],
  onProgress: (msg) => console.log(msg),
})

await fs.writeFile(`${title}.pdf`, buffer)
```

### `fetchTxt(url, options?): Promise<string>`

```ts
const text = await fetchTxt('https://chatgpt.com/share/abc123', {
  timeout: 60000,
  selector: '[data-message-author-role]',
  cookies: [...],
  executablePath: '/path/to/chrome',
  args: ['--no-sandbox'],
  onProgress: (msg) => console.log(msg),
})
```

### Types

```ts
interface FetchOptions {
  pageSize?: 'letter' | 'a4'        // PDF only
  margin?: number                    // PDF only, points
  landscape?: boolean                // PDF only
  timeout?: number                   // ms, applies to page load
  selector?: string                  // CSS selector for content nodes
  cookies?: CookieParam[]            // Puppeteer cookie objects
  executablePath?: string            // Path to Chrome binary
  args?: string[]                    // Puppeteer launch args (e.g. ['--no-sandbox'])
  onProgress?: (msg: string) => void // Progress callback
}

interface FetchResult {
  buffer: Buffer  // PDF bytes
  title: string   // Page title, sanitized for use as a filename
}
```

### Express example

```ts
import express from 'express'
import { fetchPdf } from 'snapdf'

const app = express()

app.get('/pdf', async (req, res) => {
  const { url } = req.query
  const { buffer } = await fetchPdf(String(url))
  res.setHeader('Content-Type', 'application/pdf')
  res.send(buffer)
})
```

## Cookies / Private pages

Pass session cookies to access pages behind a login:

```ts
const { buffer } = await fetchPdf('https://chatgpt.com/c/private-thread', {
  cookies: [
    { name: '__Secure-next-auth.session-token', value: '...', domain: 'chatgpt.com' }
  ]
})
```

## Serverless / Custom Chrome

Puppeteer bundles its own Chrome, which works on standard servers and locally. For serverless environments (Lambda, Vercel, etc.) use [`@sparticuz/chromium`](https://github.com/Sparticuz/chromium) and pass its executable path:

```ts
import chromium from '@sparticuz/chromium'
import { fetchPdf } from 'snapdf'

const { buffer } = await fetchPdf(url, {
  executablePath: await chromium.executablePath(),
  args: chromium.args,
})
```

## Other sites

The default selector targets ChatGPT's conversation format. For other sites, pass a CSS selector that matches the repeating content nodes you want captured:

```ts
// Claude.ai
await fetchPdf(url, { selector: '[data-testid="human-turn"], [data-testid="ai-turn"]' })

// Generic blog/article
await fetchPdf(url, { selector: 'article' })
```
