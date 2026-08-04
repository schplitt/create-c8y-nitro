#!/usr/bin/env node
import type { PackageManagerName } from 'nypm'
import process from 'node:process'
import { defineCommand, runMain } from 'citty'
import { consola } from 'consola'
import { colors } from 'consola/utils'
import { runScriptCommand } from 'nypm'
import { relative, resolve } from 'pathe'
import { hasTTY, isAgent } from 'std-env'
import pkg from '../package.json' with { type: 'json' }
import {
  DEFAULT_TEMPLATE,
  detectCurrentPackageManager,
  isNonEmptyDir,
  packageManagerNames,
  scaffold,
} from './scaffold'

const DEFAULT_DIR = 'c8y-nitro-app'

const main = defineCommand({
  meta: {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
  },
  args: {
    dir: {
      type: 'positional',
      description: 'Directory to scaffold the microservice into',
      required: false,
    },
    name: {
      type: 'string',
      description: 'Package / microservice name (defaults to the directory name)',
    },
    template: {
      type: 'string',
      alias: 't',
      description: 'Template source (giget source or file:<path>)',
      default: DEFAULT_TEMPLATE,
    },
    force: {
      type: 'boolean',
      description: 'Scaffold into a non-empty directory',
      default: false,
    },
    install: {
      type: 'boolean',
      description: 'Install dependencies after scaffolding',
      negativeDescription: 'Skip dependency installation',
      default: true,
    },
    packageManager: {
      type: 'string',
      alias: 'p',
      description: `Package manager choice (${packageManagerNames.join(', ')})`,
    },
    git: {
      type: 'boolean',
      description: 'Initialize a git repository',
      negativeDescription: 'Skip git initialization',
    },
  },
  async run({ args }) {
    const interactive = hasTTY && !isAgent

    // Resolve the target directory
    let dir = args.dir
    if (!dir) {
      dir = interactive
        ? await consola.prompt('Where should the microservice be created?', {
            placeholder: `./${DEFAULT_DIR}`,
            type: 'text',
            default: DEFAULT_DIR,
            cancel: 'reject',
          }).catch(() => process.exit(1))
        : DEFAULT_DIR
    }

    // Handle an existing non-empty target directory
    let force = args.force
    while (!force && await isNonEmptyDir(resolve(dir))) {
      const relativeDir = colors.cyan(relative(process.cwd(), resolve(dir)) || dir)
      if (!interactive) {
        consola.error(`Directory ${relativeDir} is not empty. Use --force to scaffold anyway.`)
        process.exit(1)
      }
      const action = await consola.prompt(
        `The directory ${relativeDir} is not empty. What would you like to do?`,
        {
          type: 'select',
          options: [
            { label: 'Select a different directory', value: 'new-directory' },
            { label: 'Override its contents', value: 'override' },
            { label: 'Abort', value: 'abort' },
          ],
        },
      )
      if (action === 'override') {
        force = true
      } else if (action === 'new-directory') {
        dir = await consola.prompt('Please specify a different directory:', {
          type: 'text',
          cancel: 'reject',
        }).catch(() => process.exit(1))
      } else {
        process.exit(1)
      }
    }

    // Resolve the package manager for the install step
    const detectedPackageManager = detectCurrentPackageManager()
    const packageManagerArg = args.packageManager as PackageManagerName
    let packageManager: PackageManagerName | undefined
    let install = args.install
    if (install) {
      if (packageManagerNames.includes(packageManagerArg)) {
        packageManager = packageManagerArg
      } else if (!interactive) {
        packageManager = detectedPackageManager ?? 'npm'
      } else {
        const selected = await consola.prompt('Which package manager would you like to use?', {
          type: 'select',
          initial: detectedPackageManager,
          cancel: 'undefined',
          options: [
            { label: '(none)', value: '', hint: 'Skip install dependencies step' },
            ...packageManagerNames.map((pm) => ({
              label: pm,
              value: pm,
              hint: detectedPackageManager === pm ? 'current' : undefined,
            })),
          ],
        }) as PackageManagerName | '' | undefined
        if (selected) {
          packageManager = selected
        } else {
          install = false
        }
      }
    }

    // Resolve git initialization
    let gitInit = args.git
    if (gitInit === undefined) {
      gitInit = interactive
        ? Boolean(await consola.prompt('Initialize git repository?', {
            type: 'confirm',
            cancel: 'undefined',
          }))
        : false
    }

    const result = await scaffold({
      dir,
      name: args.name,
      template: args.template,
      force,
      install,
      packageManager,
      gitInit,
    }).catch((error) => {
      consola.error(error instanceof Error ? error.message : error)
      return process.exit(1)
    })

    consola.success(`Scaffolded ${colors.cyan(result.name)} in ${colors.cyan(result.dir)}`)
    consola.info('Next steps:')
    const relativeDir = relative(process.cwd(), result.dir) || '.'
    if (relativeDir !== '.') {
      consola.log(` › cd \`${relativeDir}\``)
    }
    if (!install) {
      consola.log(` › install dependencies (e.g. \`${detectedPackageManager ?? 'pnpm'} install\`)`)
    }
    consola.log(` › \`${runScriptCommand(packageManager ?? detectedPackageManager ?? 'pnpm', 'dev')}\``)
  },
})

runMain(main)
