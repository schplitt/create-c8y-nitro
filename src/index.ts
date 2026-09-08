export type {
  AuthorResolver,
  AuthorSource,
  DetectedAuthor,
  PackageAuthor,
  ScaffoldOptions,
  ScaffoldResult,
} from './scaffold'
export {
  authorFromEnv,
  authorFromGit,
  DEFAULT_TEMPLATE,
  detectAuthor,
  formatAuthor,
  parseAuthor,
  patchPackageJson,
  scaffold,
  slugifyPackageName,
} from './scaffold'
