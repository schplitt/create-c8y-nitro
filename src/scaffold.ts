import type { PackageManagerName } from 'nypm'
import { existsSync } from 'node:fs'
import { cp, readdir, readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { downloadTemplate } from 'giget'
import { installDependencies, packageManagers } from 'nypm'
import { basename, dirname, join, resolve } from 'pathe'
import { x } from 'tinyexec'

export const DEFAULT_TEMPLATE = 'gh:schplitt/c8y-nitro-starter'

export const packageManagerNames = packageManagers.map((pm) => pm.name)

/**
 * Fields in the template's package.json that describe the template (and its
 * author), not the scaffolded microservice. They are stripped on scaffold.
 * `author` is stripped too, then re-added from the resolved author.
 */
const TEMPLATE_ONLY_FIELDS = [
  'description',
  'author',
  'contributors',
  'homepage',
  'bugs',
  'repository',
  'keywords',
  'license',
  'funding',
] as const

/**
 * package.json `author`, in object form. The email is omitted rather than left
 * empty when unknown, so a missing contact stays visibly missing.
 */
export interface PackageAuthor {
  name: string
  email?: string
}

/**
 * Where a detected author came from, for reporting.
 */
export type AuthorSource = 'git config' | 'npm config'

export interface DetectedAuthor {
  author: PackageAuthor
  source: AuthorSource
}

/**
 * Picks the author to write, given what could be detected in the scaffolded
 * directory. Its return value is authoritative — returning `undefined`
 * scaffolds without an author.
 */
export type AuthorResolver = (detected: DetectedAuthor | undefined) =>
  | string | PackageAuthor | undefined
  | Promise<string | PackageAuthor | undefined>

export interface ScaffoldOptions {
  /**
   * Target directory, relative to `cwd` or absolute.
   */
  dir: string
  /**
   * Package name. Defaults to the slugified basename of `dir`.
   */
  name?: string
  /**
   * package.json author, either structured or as `Name <email>`. Defaults to
   * the author detected via {@link detectAuthor}; pass an empty string to
   * scaffold without an author, or a {@link AuthorResolver} to decide based on
   * what was detected (used by the CLI to prompt).
   */
  author?: string | PackageAuthor | AuthorResolver
  /**
   * giget template source, or `file:<path>` for a local directory.
   */
  template?: string
  cwd?: string
  /**
   * Scaffold into a non-empty directory.
   */
  force?: boolean
  install?: boolean
  /**
   * Package manager used for the install step. Defaults to nypm's detection.
   */
  packageManager?: PackageManagerName
  gitInit?: boolean
  /**
   * Override the download step (used in tests).
   */
  download?: (template: string, dir: string) => Promise<void>
}

export interface ScaffoldResult {
  dir: string
  name: string
  /**
   * Author written to package.json, or `undefined` if none could be resolved.
   */
  author?: PackageAuthor
}

/**
 * Derive a valid npm package name. Cumulocity also uses the package name as
 * the microservice name, which allows only lowercase letters, digits and
 * hyphens — so those are the only characters kept.
 * @param input Raw name, e.g. the target directory's basename
 */
export function slugifyPackageName(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'c8y-nitro-app'
}

/**
 * Detect the package manager the CLI was invoked through, e.g. `pnpm create`.
 * @param userAgent Defaults to `process.env.npm_config_user_agent`
 */
export function detectCurrentPackageManager(userAgent = process.env.npm_config_user_agent): PackageManagerName | undefined {
  const name = userAgent?.split('/')[0]
  return packageManagerNames.find((pm) => pm === name)
}

/**
 * Parse npm's `Name <email> (url)` author string. A name is required — an
 * author with only an email is treated as no author at all.
 * @param input Author string, or an already structured author
 */
export function parseAuthor(input: string | PackageAuthor): PackageAuthor | undefined {
  if (typeof input !== 'string') {
    return input.name.trim() ? input : undefined
  }
  const email = input.match(/<([^>]*)>/)?.[1]?.trim()
  const name = input.replace(/<[^>]*>/, '').replace(/\([^)]*\)/, '').trim()
  if (!name) {
    return undefined
  }
  return email ? { name, email } : { name }
}

/**
 * Render an author as `Name <email>` for display and prompt defaults.
 * @param author Author to render
 */
export function formatAuthor(author: PackageAuthor): string {
  return author.email ? `${author.name} <${author.email}>` : author.name
}

/**
 * The nearest existing ancestor of `path` (or `path` itself). Git config is
 * read from there so that a repo-local `user.name` still applies when the
 * target directory does not exist yet — e.g. scaffolding into a monorepo.
 * @param path Path to walk up from
 */
export function nearestExistingDir(path: string): string {
  let current = resolve(path)
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }
  return current
}

async function gitConfig(key: string, cwd: string): Promise<string | undefined> {
  try {
    // `git config --get` exits non-zero for unset keys
    const { exitCode, stdout } = await x('git', ['config', '--get', key], { nodeOptions: { cwd } })
    return exitCode === 0 ? stdout.trim() || undefined : undefined
  } catch {
    // `git` may not be installed at all
    return undefined
  }
}

/**
 * Author from `git config user.name` / `user.email`.
 * @param cwd Directory to read the config from, see {@link nearestExistingDir}
 */
export async function authorFromGit(cwd: string): Promise<PackageAuthor | undefined> {
  const [name, email] = await Promise.all([
    gitConfig('user.name', cwd),
    gitConfig('user.email', cwd),
  ])
  if (!name) {
    return undefined
  }
  return email ? { name, email } : { name }
}

/**
 * Author from npm's `init-author-name` / `init-author-email` config, which npm
 * and friends expose as env vars when the CLI runs via `npm create`.
 * @param env Defaults to `process.env`
 */
export function authorFromEnv(env: Record<string, string | undefined> = process.env): PackageAuthor | undefined {
  const name = env.npm_config_init_author_name?.trim()
  const email = env.npm_config_init_author_email?.trim()
  if (!name) {
    return undefined
  }
  return email ? { name, email } : { name }
}

/**
 * Detect the author to write into package.json: git config first, then npm's
 * init defaults.
 *
 * Detection is most accurate once `dir` is a git repository — a `git config`
 * `includeIf "gitdir:…"` identity only resolves from inside one, which is why
 * {@link scaffold} runs `git init` before this.
 * @param dir Target directory, which need not exist yet
 * @param env Passed on to {@link authorFromEnv}
 */
export async function detectAuthor(dir: string, env?: Record<string, string | undefined>): Promise<DetectedAuthor | undefined> {
  const fromGit = await authorFromGit(nearestExistingDir(dir))
  if (fromGit) {
    return { author: fromGit, source: 'git config' }
  }
  const fromEnv = authorFromEnv(env)
  return fromEnv ? { author: fromEnv, source: 'npm config' } : undefined
}

async function resolveScaffoldAuthor(dir: string, option: ScaffoldOptions['author']): Promise<PackageAuthor | undefined> {
  if (typeof option === 'function') {
    const picked = await option(await detectAuthor(dir))
    return picked === undefined ? undefined : parseAuthor(picked)
  }
  if (option === undefined) {
    return (await detectAuthor(dir))?.author
  }
  return parseAuthor(option)
}

export async function isNonEmptyDir(path: string): Promise<boolean> {
  return existsSync(path) && (await readdir(path)).length > 0
}

export async function patchPackageJson(dir: string, name: string, author?: PackageAuthor): Promise<void> {
  const path = join(dir, 'package.json')
  const pkg = JSON.parse(await readFile(path, 'utf8'))
  pkg.name = name
  pkg.version = '0.0.0'
  pkg.private = true
  for (const field of TEMPLATE_ONLY_FIELDS) {
    delete pkg[field]
  }
  if (author) {
    pkg.author = author.email ? { name: author.name, email: author.email } : { name: author.name }
  }
  await writeFile(path, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
}

async function defaultDownload(template: string, dir: string): Promise<void> {
  if (template.startsWith('file:')) {
    await cp(resolve(template.slice('file:'.length)), dir, { recursive: true })
    return
  }
  await downloadTemplate(template, { dir, force: true })
}

export async function scaffold(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const cwd = resolve(options.cwd ?? process.cwd())
  const dir = resolve(cwd, options.dir)
  const template = options.template ?? DEFAULT_TEMPLATE

  if (!options.force && await isNonEmptyDir(dir)) {
    throw new Error(`Directory \`${dir}\` is not empty. Pass --force to scaffold anyway.`)
  }

  const download = options.download ?? defaultDownload
  await download(template, dir)

  if (!existsSync(join(dir, 'package.json'))) {
    throw new Error(`Template \`${template}\` does not contain a package.json.`)
  }

  // Initialize git before detecting the author, so that a `git config`
  // `includeIf "gitdir:…"` identity resolves against the new repository.
  if (options.gitInit) {
    await x('git', ['init'], { nodeOptions: { cwd: dir, stdio: 'ignore' }, throwOnError: true })
  }

  const name = slugifyPackageName(options.name ?? basename(dir))
  const author = await resolveScaffoldAuthor(dir, options.author)
  await patchPackageJson(dir, name, author)

  if (options.install) {
    await installDependencies({
      cwd: dir,
      packageManager: options.packageManager
        ? { name: options.packageManager, command: options.packageManager }
        : undefined,
    })
  }

  return { dir, name, author }
}
