import { createProgram } from './program'

export type { PageSizeKey } from './constants'
export type { FetchOptions } from './fetch'
export { fetchPdf, fetchTxt } from './fetch'

await createProgram().parse(process.argv)
