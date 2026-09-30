import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const projectRoot = dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ command }) => ({
  server: command === 'serve'
    ? {
        host: '0.0.0.0',
        https: {
          cert: readFileSync(resolve(projectRoot, '.cert/dev-cert.pem')),
          key: readFileSync(resolve(projectRoot, '.cert/dev-key.pem')),
        },
      }
    : undefined,
}))
