import neostandard from 'neostandard'

export default [
  ...neostandard({
    env: ['browser', 'webextensions'],
    globals: {
      chrome: 'readonly',
      ImageViewer: 'readonly',
      ImageViewerUtils: 'readonly'
    }
  }),
  {
    rules: {
      'object-shorthand': 'off',
      '@stylistic/space-before-function-paren': 'off',
      '@stylistic/object-curly-spacing': 'off',
      '@stylistic/spaced-comment': 'off',
      '@stylistic/indent': 'off'
    }
  }
]
