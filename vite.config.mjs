import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const projectRoot = dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ command }) => ({
  // GitHub Pages serves this repository below /ichbinminseo/. Keep local
  // development at the domain root while making production URLs portable.
  base: command === 'build' && process.env.GITHUB_REPOSITORY
    ? `/${process.env.GITHUB_REPOSITORY.split('/')[1]}/`
    : '/',
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
