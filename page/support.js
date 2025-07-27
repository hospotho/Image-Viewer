;(function () {
  'use strict'

  chrome.i18n.getAcceptLanguages(languages => {
    const exist = ['en', 'ja', 'zh_CN', 'zh_TW']
    let displayLanguages = 'en'
    for (const lang of languages) {
      if (exist.includes(lang.replace('-', '_'))) {
        displayLanguages = lang
        break
      }
      if (exist.includes(lang.slice(0, 2))) {
        displayLanguages = lang.slice(0, 2)
        break
      }
    }
    document.documentElement.setAttribute('lang', displayLanguages)
  })

  for (const el of document.querySelectorAll('[data-i18n]')) {
    const tag = el.getAttribute('data-i18n')
    const message = chrome.i18n.getMessage(tag)
    if (!message) continue
    el.textContent = message
    if (el.value !== '') el.value = message
  }

  const manifest = chrome.runtime.getManifest()
  document.getElementById('version').textContent += manifest.version
})()
