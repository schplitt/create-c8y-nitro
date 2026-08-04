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
- template metadata (`author`, `homepage`, `bugs`, `description`, …) is stripped

Then it initializes git and installs dependencies with your package manager.

## Options

```sh
create-c8y-nitro [dir] [options]
```

| Option                | Default                         | Description                                          |
| --------------------- | ------------------------------- | ---------------------------------------------------- |
| `--name <name>`       | directory name                  | Package / microservice name                          |
| `--template <source>` | `gh:schplitt/c8y-nitro-starter` | giget source, or `file:<path>` for a local directory |
| `--force`             | `false`                         | Scaffold into a non-empty directory                  |
| `--no-install`        | —                               | Skip dependency installation                         |
| `--no-git`            | —                               | Skip `git init`                                      |

## Programmatic usage

```ts
import { scaffold } from 'create-c8y-nitro'

await scaffold({
  dir: 'my-service',
  install: false,
  gitInit: false,
})
```

## License

MIT
