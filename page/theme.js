;(function () {
  'use strict'

  function readPreference() {
    const saved = localStorage.getItem(storageKey)
    return ['light', 'dark'].includes(saved) ? saved : 'system'
  }

  function applyTheme() {
    const theme = preference === 'system' ? (systemTheme.matches ? 'dark' : 'light') : preference
    document.documentElement.dataset.theme = theme
    for (const input of document.querySelectorAll('.theme-switch input')) {
      input.checked = input.value === preference
    }
    const markdownStyle = document.getElementById('markdown-style')
    if (markdownStyle) {
      const href = `https://sindresorhus.com/github-markdown-css/github-markdown-${theme}.css`
      if (markdownStyle.href !== href) markdownStyle.href = href
    }
  }

  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
  const storageKey = 'page-theme'
  let preference = readPreference()
  applyTheme()

  systemTheme.addEventListener('change', applyTheme)
  window.addEventListener('storage', event => {
    if (event.key !== storageKey && event.key !== null) return
    preference = readPreference()
    applyTheme()
  })

  document.querySelector('.theme-switch').addEventListener('change', event => {
    const value = event.target.value
    if (!['system', 'light', 'dark'].includes(value)) return
    preference = value
    localStorage.setItem(storageKey, preference)
    applyTheme()
  })
})()
