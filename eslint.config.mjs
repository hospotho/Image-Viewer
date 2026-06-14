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
      '@stylistic/generator-star-spacing': 'off',
      '@stylistic/indent': 'off',
      '@stylistic/object-curly-spacing': 'off',
      '@stylistic/space-before-function-paren': 'off',
      '@stylistic/spaced-comment': 'off',
      'object-shorthand': 'off'
    }
  }
]
