import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { x } from 'tinyexec'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const CLI_PATH = join(import.meta.dirname, '../dist/cli.mjs')
const FIXTURE_TEMPLATE = `file:${join(import.meta.dirname, 'fixtures/template')}`

// The CLI e2e tests run against the build output. CI and `pnpm prerelease`
// always build before testing; locally run `pnpm build` first.
describe.skipIf(!existsSync(CLI_PATH))('cli (e2e, requires `pnpm build`)', () => {
  let cwd: string

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'create-c8y-nitro-cli-'))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  it('scaffolds a project end to end', async () => {
    const result = await x('node', [CLI_PATH, 'my-cli-service', '--template', FIXTURE_TEMPLATE, '--author', '', '--no-install', '--no-git'], {
      nodeOptions: { cwd },
      throwOnError: true,
    })

    expect(result.exitCode).toBe(0)

    const pkg = JSON.parse(await readFile(join(cwd, 'my-cli-service/package.json'), 'utf8'))
    expect(pkg.name).toBe('my-cli-service')
    expect(pkg.version).toBe('0.0.0')
    // `--author ""` opts out explicitly; the template's author must not leak
    expect(pkg).not.toHaveProperty('author')
    expect(pkg).not.toHaveProperty('homepage')
    expect(existsSync(join(cwd, 'my-cli-service/.git'))).toBe(false)
  })

  it('respects --name and --git', async () => {
    await x('node', [CLI_PATH, 'some-dir', '--name', 'Custom Name', '--template', FIXTURE_TEMPLATE, '--no-install', '--git'], {
      nodeOptions: { cwd },
      throwOnError: true,
    })

    const pkg = JSON.parse(await readFile(join(cwd, 'some-dir/package.json'), 'utf8'))
    expect(pkg.name).toBe('custom-name')
    expect(existsSync(join(cwd, 'some-dir/.git'))).toBe(true)
  })

  it('writes the author from --author', async () => {
    await x('node', [CLI_PATH, 'authored', '--author', 'Jane Doe <jane@example.com>', '--template', FIXTURE_TEMPLATE, '--no-install', '--no-git'], {
      nodeOptions: { cwd },
      throwOnError: true,
    })

    const pkg = JSON.parse(await readFile(join(cwd, 'authored/package.json'), 'utf8'))
    expect(pkg.author).toEqual({ name: 'Jane Doe', email: 'jane@example.com' })
  })

  it('falls back to the git identity when --author is omitted', async () => {
    await x('git', ['init'], { nodeOptions: { cwd, stdio: 'ignore' }, throwOnError: true })
    await x('git', ['config', '--local', 'user.name', 'Git Dev'], { nodeOptions: { cwd }, throwOnError: true })
    await x('git', ['config', '--local', 'user.email', 'git-dev@example.com'], { nodeOptions: { cwd }, throwOnError: true })

    await x('node', [CLI_PATH, 'from-git', '--template', FIXTURE_TEMPLATE, '--no-install', '--no-git'], {
      nodeOptions: { cwd },
      throwOnError: true,
    })

    const pkg = JSON.parse(await readFile(join(cwd, 'from-git/package.json'), 'utf8'))
    expect(pkg.author).toEqual({ name: 'Git Dev', email: 'git-dev@example.com' })
  })

  it('fails on a non-empty directory without --force', async () => {
    await x('node', [CLI_PATH, 'clash', '--template', FIXTURE_TEMPLATE, '--no-install', '--no-git'], {
      nodeOptions: { cwd },
      throwOnError: true,
    })

    const second = await x('node', [CLI_PATH, 'clash', '--template', FIXTURE_TEMPLATE, '--no-install', '--no-git'], {
      nodeOptions: { cwd },
    })
    expect(second.exitCode).not.toBe(0)
  })

  it('prints usage with --help', async () => {
    const result = await x('node', [CLI_PATH, '--help'], { throwOnError: true })
    expect(`${result.stdout}${result.stderr}`).toContain('create-c8y-nitro')
  })
})
