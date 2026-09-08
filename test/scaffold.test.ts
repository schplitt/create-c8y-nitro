import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { x } from 'tinyexec'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import process from 'node:process'
import { authorFromEnv, authorFromGit, detectCurrentPackageManager, formatAuthor, parseAuthor, scaffold, slugifyPackageName } from '../src/scaffold'

const FIXTURE_TEMPLATE = `file:${join(import.meta.dirname, 'fixtures/template')}`

describe('slugifyPackageName', () => {
  it.each([
    ['my-app', 'my-app'],
    ['My App', 'my-app'],
    ['  Fancy_Service! ', 'fancy-service'],
    ['already-valid-123', 'already-valid-123'],
    ['---', 'c8y-nitro-app'],
    ['', 'c8y-nitro-app'],
  ])('turns %j into %j', (input, expected) => {
    expect(slugifyPackageName(input)).toBe(expected)
  })
})

describe('detectCurrentPackageManager', () => {
  it.each([
    ['pnpm/9.15.0 npm/? node/v24.0.0 darwin arm64', 'pnpm'],
    ['npm/10.8.0 node/v24.0.0 darwin arm64', 'npm'],
    ['yarn/4.5.0 npm/? node/v24.0.0', 'yarn'],
    ['bun/1.2.0 npm/? node/v24.0.0', 'bun'],
  ])('detects %j as %j', (userAgent, expected) => {
    expect(detectCurrentPackageManager(userAgent)).toBe(expected)
  })

  it('returns undefined for unknown or missing user agents', () => {
    expect(detectCurrentPackageManager('carrier-pigeon/1.0.0')).toBeUndefined()
    expect(detectCurrentPackageManager('')).toBeUndefined()
  })
})

describe('parseAuthor', () => {
  it.each([
    ['Jane Doe <jane@example.com>', { name: 'Jane Doe', email: 'jane@example.com' }],
    ['  Jane Doe  ', { name: 'Jane Doe' }],
    ['Jane Doe <jane@example.com> (https://example.com)', { name: 'Jane Doe', email: 'jane@example.com' }],
    [{ name: 'Jane Doe', email: 'jane@example.com' }, { name: 'Jane Doe', email: 'jane@example.com' }],
  ])('parses %j', (input, expected) => {
    expect(parseAuthor(input)).toEqual(expected)
  })

  it.each([
    [''],
    ['   '],
    ['<jane@example.com>'],
    [{ name: '' }],
  ])('treats %j as no author', (input) => {
    expect(parseAuthor(input)).toBeUndefined()
  })
})

describe('formatAuthor', () => {
  it('renders name and email', () => {
    expect(formatAuthor({ name: 'Jane Doe', email: 'jane@example.com' })).toBe('Jane Doe <jane@example.com>')
    expect(formatAuthor({ name: 'Jane Doe' })).toBe('Jane Doe')
  })
})

describe('authorFromEnv', () => {
  it('reads npm init defaults', () => {
    expect(authorFromEnv({
      npm_config_init_author_name: 'Jane Doe',
      npm_config_init_author_email: 'jane@example.com',
    })).toEqual({ name: 'Jane Doe', email: 'jane@example.com' })
  })

  it('omits an empty email', () => {
    expect(authorFromEnv({
      npm_config_init_author_name: 'Jane Doe',
      npm_config_init_author_email: '  ',
    })).toEqual({ name: 'Jane Doe' })
  })

  it('requires a name', () => {
    expect(authorFromEnv({ npm_config_init_author_email: 'jane@example.com' })).toBeUndefined()
    expect(authorFromEnv({})).toBeUndefined()
  })
})

describe('authorFromGit', () => {
  let repo: string

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'create-c8y-nitro-git-'))
    await x('git', ['init'], { nodeOptions: { cwd: repo, stdio: 'ignore' }, throwOnError: true })
  })

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true })
  })

  async function setLocalConfig(key: string, value: string): Promise<void> {
    await x('git', ['config', '--local', key, value], { nodeOptions: { cwd: repo }, throwOnError: true })
  }

  it('reads the repo-local identity', async () => {
    await setLocalConfig('user.name', 'Jane Doe')
    await setLocalConfig('user.email', 'jane@example.com')

    await expect(authorFromGit(repo)).resolves.toEqual({ name: 'Jane Doe', email: 'jane@example.com' })
  })

  it('omits a missing email', async () => {
    await setLocalConfig('user.name', 'Jane Doe')
    // `--local` wins over any global user.email, and an empty value reads as unset
    await setLocalConfig('user.email', '')

    await expect(authorFromGit(repo)).resolves.toEqual({ name: 'Jane Doe' })
  })

  it('returns undefined without a configured name', async () => {
    await setLocalConfig('user.name', '')

    await expect(authorFromGit(repo)).resolves.toBeUndefined()
  })
})

describe('scaffold', () => {
  let cwd: string

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'create-c8y-nitro-test-'))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  async function readScaffoldedPkg(dir: string): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  }

  it('copies the template and derives the name from the directory', async () => {
    const result = await scaffold({
      dir: 'my-service',
      cwd,
      author: '',
      template: FIXTURE_TEMPLATE,
      install: false,
      gitInit: false,
    })

    expect(result.name).toBe('my-service')
    expect(result.dir).toBe(join(cwd, 'my-service'))

    const pkg = await readScaffoldedPkg(result.dir)
    expect(pkg.name).toBe('my-service')
    expect(pkg.version).toBe('0.0.0')
    expect(pkg.private).toBe(true)

    // template-only metadata must be gone
    expect(pkg).not.toHaveProperty('description')
    expect(pkg).not.toHaveProperty('author')
    expect(pkg).not.toHaveProperty('homepage')
    expect(pkg).not.toHaveProperty('bugs')

    // everything the app actually needs survives
    expect(pkg.scripts).toMatchObject({ dev: 'nitro dev', build: 'nitro build' })
    expect(pkg.dependencies).toMatchObject({ 'c8y-nitro': '^0.8.0' })

    // rest of the template is copied over
    await expect(readFile(join(result.dir, 'nitro.config.ts'), 'utf8')).resolves.toContain('defineNitroConfig')
    await expect(readFile(join(result.dir, 'server/routes/index.ts'), 'utf8')).resolves.toContain('defineEventHandler')
  })

  it('slugifies the directory name', async () => {
    const result = await scaffold({
      dir: 'My Fancy Service',
      cwd,
      template: FIXTURE_TEMPLATE,
      install: false,
      gitInit: false,
    })

    const pkg = await readScaffoldedPkg(result.dir)
    expect(pkg.name).toBe('my-fancy-service')
  })

  it('prefers an explicit name over the directory name', async () => {
    const result = await scaffold({
      dir: 'some-dir',
      name: 'Explicit Name',
      cwd,
      template: FIXTURE_TEMPLATE,
      install: false,
      gitInit: false,
    })

    const pkg = await readScaffoldedPkg(result.dir)
    expect(pkg.name).toBe('explicit-name')
  })

  it('refuses a non-empty target directory without force', async () => {
    await mkdir(join(cwd, 'taken'))
    await writeFile(join(cwd, 'taken/existing.txt'), 'hi')

    await expect(scaffold({
      dir: 'taken',
      cwd,
      template: FIXTURE_TEMPLATE,
      install: false,
      gitInit: false,
    })).rejects.toThrow(/not empty/)
  })

  it('scaffolds into a non-empty directory with force', async () => {
    await mkdir(join(cwd, 'taken'))
    await writeFile(join(cwd, 'taken/existing.txt'), 'hi')

    const result = await scaffold({
      dir: 'taken',
      cwd,
      template: FIXTURE_TEMPLATE,
      force: true,
      install: false,
      gitInit: false,
    })

    const pkg = await readScaffoldedPkg(result.dir)
    expect(pkg.name).toBe('taken')
  })

  it('fails clearly when the template has no package.json', async () => {
    await mkdir(join(cwd, 'empty-template'))
    await writeFile(join(cwd, 'empty-template/README.md'), '# not a template')

    await expect(scaffold({
      dir: 'out',
      cwd,
      template: `file:${join(cwd, 'empty-template')}`,
      install: false,
      gitInit: false,
    })).rejects.toThrow(/does not contain a package\.json/)
  })

  it('supports a custom download step', async () => {
    const result = await scaffold({
      dir: 'injected',
      cwd,
      author: '',
      install: false,
      gitInit: false,
      download: async (_template, dir) => {
        await mkdir(dir, { recursive: true })
        await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', author: 'someone' }))
      },
    })

    const pkg = await readScaffoldedPkg(result.dir)
    expect(pkg.name).toBe('injected')
    expect(pkg.version).toBe('0.0.0')
    expect(pkg).not.toHaveProperty('author')
  })

  it('initializes a git repository when requested', async () => {
    const result = await scaffold({
      dir: 'with-git',
      cwd,
      template: FIXTURE_TEMPLATE,
      install: false,
      gitInit: true,
    })

    const { existsSync } = await import('node:fs')
    expect(existsSync(join(result.dir, '.git'))).toBe(true)
  })

  it('writes the author and replaces the template\'s', async () => {
    const result = await scaffold({
      dir: 'authored',
      cwd,
      author: 'Jane Doe <jane@example.com>',
      template: FIXTURE_TEMPLATE,
      install: false,
      gitInit: false,
    })

    expect(result.author).toEqual({ name: 'Jane Doe', email: 'jane@example.com' })
    const pkg = await readScaffoldedPkg(result.dir)
    expect(pkg.author).toEqual({ name: 'Jane Doe', email: 'jane@example.com' })
  })

  it('omits the email key instead of writing an empty one', async () => {
    const result = await scaffold({
      dir: 'no-email',
      cwd,
      author: { name: 'Jane Doe' },
      template: FIXTURE_TEMPLATE,
      install: false,
      gitInit: false,
    })

    const pkg = await readScaffoldedPkg(result.dir)
    expect(pkg.author).toEqual({ name: 'Jane Doe' })
    expect(Object.keys(pkg.author as object)).not.toContain('email')
  })

  it('detects the author when none is given', async () => {
    await x('git', ['init'], { nodeOptions: { cwd, stdio: 'ignore' }, throwOnError: true })
    await x('git', ['config', '--local', 'user.name', 'Detected Dev'], { nodeOptions: { cwd }, throwOnError: true })
    await x('git', ['config', '--local', 'user.email', 'dev@example.com'], { nodeOptions: { cwd }, throwOnError: true })

    const result = await scaffold({
      dir: 'detected',
      cwd,
      template: FIXTURE_TEMPLATE,
      install: false,
      gitInit: false,
    })

    expect(result.author).toEqual({ name: 'Detected Dev', email: 'dev@example.com' })
  })

  it('lets an author resolver decide, based on what was detected', async () => {
    const detectedArgs: unknown[] = []

    const result = await scaffold({
      dir: 'resolved',
      cwd,
      author: (detected) => {
        detectedArgs.push(detected)
        return 'Chosen One <chosen@example.com>'
      },
      template: FIXTURE_TEMPLATE,
      install: false,
      gitInit: false,
    })

    expect(detectedArgs).toHaveLength(1)
    expect(result.author).toEqual({ name: 'Chosen One', email: 'chosen@example.com' })
  })

  it('scaffolds without an author when the resolver returns undefined', async () => {
    const result = await scaffold({
      dir: 'declined',
      cwd,
      author: () => undefined,
      template: FIXTURE_TEMPLATE,
      install: false,
      gitInit: false,
    })

    expect(result.author).toBeUndefined()
    await expect(readScaffoldedPkg(result.dir)).resolves.not.toHaveProperty('author')
  })

  it('picks up a directory-scoped git identity, which needs `git init` first', async () => {
    // A `includeIf "gitdir:…"` identity only resolves from inside a repository,
    // so this only works because `scaffold` runs `git init` before detecting.
    const realCwd = realpathSync(cwd)
    const scopedConfig = join(cwd, 'gitconfig-scoped')
    const globalConfig = join(cwd, 'gitconfig-global')
    await writeFile(scopedConfig, '[user]\n  name = Scoped Dev\n  email = scoped@example.com\n')
    await writeFile(globalConfig, `[includeIf "gitdir:${realCwd}/"]\n  path = ${scopedConfig}\n`)

    const { GIT_CONFIG_GLOBAL: prevGlobal, GIT_CONFIG_SYSTEM: prevSystem } = process.env
    process.env.GIT_CONFIG_GLOBAL = globalConfig
    process.env.GIT_CONFIG_SYSTEM = '/dev/null'
    try {
      const result = await scaffold({
        dir: 'scoped',
        cwd,
        template: FIXTURE_TEMPLATE,
        install: false,
        gitInit: true,
      })

      expect(result.author).toEqual({ name: 'Scoped Dev', email: 'scoped@example.com' })
    } finally {
      process.env.GIT_CONFIG_GLOBAL = prevGlobal
      process.env.GIT_CONFIG_SYSTEM = prevSystem
    }
  })
})
