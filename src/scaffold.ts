import type { PackageManagerName } from 'nypm'
import { existsSync } from 'node:fs'
import { cp, readdir, readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { downloadTemplate } from 'giget'
import { installDependencies, packageManagers } from 'nypm'
import { basename, join, resolve } from 'pathe'
import { x } from 'tinyexec'

export const DEFAULT_TEMPLATE = 'gh:schplitt/c8y-nitro-starter'

export const packageManagerNames = packageManagers.map((pm) => pm.name)

/**
 * Fields in the template's package.json that describe the template (and its
 * author), not the scaffolded microservice. They are stripped on scaffold.
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

export async function isNonEmptyDir(path: string): Promise<boolean> {
  return existsSync(path) && (await readdir(path)).length > 0
}

export async function patchPackageJson(dir: string, name: string): Promise<void> {
  const path = join(dir, 'package.json')
  const pkg = JSON.parse(await readFile(path, 'utf8'))
  pkg.name = name
  pkg.version = '0.0.0'
  pkg.private = true
  for (const field of TEMPLATE_ONLY_FIELDS) {
    delete pkg[field]
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

  const name = slugifyPackageName(options.name ?? basename(dir))
  await patchPackageJson(dir, name)

  if (options.gitInit) {
    await x('git', ['init'], { nodeOptions: { cwd: dir, stdio: 'ignore' }, throwOnError: true })
  }

  if (options.install) {
    await installDependencies({
      cwd: dir,
      packageManager: options.packageManager
        ? { name: options.packageManager, command: options.packageManager }
        : undefined,
    })
  }

  return { dir, name }
}
