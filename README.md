# create-c8y-nitro

Scaffold a [Cumulocity IoT](https://www.cumulocity.com/) microservice powered by [c8y-nitro](https://github.com/schplitt/c8y-nitro).

```sh
pnpm create c8y-nitro my-service
# or
npm create c8y-nitro@latest my-service
```

This downloads the [c8y-nitro-starter](https://github.com/schplitt/c8y-nitro-starter) template and — unlike a plain `giget` clone — sets up `package.json` for _your_ project:

- `name` is derived from the target directory (or `--name`), slugified to a valid npm and Cumulocity microservice name
- `version` is reset to `0.0.0`
- `author` is set from your `git config user.name` / `user.email` (or `--author`), replacing the template's — Cumulocity requires it. Detection runs after `git init`, so a directory-specific identity (`includeIf "gitdir:…"`) resolves correctly; if nothing is found you are asked, and warned if you skip.
- the remaining template metadata (`homepage`, `bugs`, `description`, …) is stripped

Then — if you ask it to — it initializes git and installs dependencies with your package manager. A failed `git init` (no `git` installed, say) is reported but does not fail the scaffold.

## Options

```sh
create-c8y-nitro [dir] [options]
```

| Option                | Default                         | Description                                          |
| --------------------- | ------------------------------- | ---------------------------------------------------- |
| `--name <name>`       | directory name                  | Package / microservice name                          |
| `--author <author>`   | `git config`                    | Author as `Name <email>`; `--author ""` for none     |
| `--template <source>` | `gh:schplitt/c8y-nitro-starter` | giget source, or `file:<path>` for a local directory |
| `--force`             | `false`                         | Scaffold into a non-empty directory                  |
| `--no-install`        | —                               | Skip dependency installation                         |
| `--no-git`            | —                               | Skip `git init`                                      |

## Programmatic usage

```ts
import { scaffold } from 'create-c8y-nitro'

await scaffold({
  dir: 'my-service',
  author: 'Jane Doe <jane@example.com>', // defaults to the detected git author
  install: false,
  gitInit: false,
})
```

## License

MIT
