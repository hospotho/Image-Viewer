import globals from 'globals'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import js from '@eslint/js'
import {FlatCompat} from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all
})

export default [
  ...compat.extends('standard'),
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ImageViewer: false,
        ImageViewerUtils: false
      },

      ecmaVersion: 'latest',
      sourceType: 'module'
    },

    rules: {
      'space-before-function-paren': 'off',
      'object-curly-spacing': 'off',
      'spaced-comment': 'off',
      'object-shorthand': 'off',
      indent: 'off'
    }
  }
]
