import schplitt from '@schplitt/eslint-config'

export default schplitt({
  ignores: ['test/fixtures/**'],
}).overrideRules({
  'antfu/no-top-level-await': 'off',
})
