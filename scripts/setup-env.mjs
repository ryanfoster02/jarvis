#!/usr/bin/env node
// Creates .env from .env.example if it doesn't exist yet. Never overwrites an existing .env.
import { copyFileSync, existsSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = join(root, '.env')
if (existsSync(env)) {
  console.log('.env already exists — left unchanged. Add your key on the OPENAI_API_KEY= line.')
} else {
  copyFileSync(join(root, '.env.example'), env)
  try {
    chmodSync(env, 0o600) // readable only by you
  } catch {
    /* not supported on this filesystem */
  }
  console.log('Created .env. Open it and paste your key after OPENAI_API_KEY=, then run npm run dev.')
}
