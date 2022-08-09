;(function () {
  'use strict'

  function i18n() {
    for (const el of document.querySelectorAll('[data-i18n]')) {
      const tag = el.getAttribute('data-i18n')
      const message = chrome.i18n.getMessage(tag)
      if (message) {
        el.innerHTML = message
        if (el.value != '') el.value = message
      }
    }
  }

  function setValue(options) {
    document.querySelector(`input#fit-${options.fitMode}`).checked = true
    document.querySelector('input#zoomRatio').value = options.zoomRatio
    document.querySelector('input#zoomRatio').nextElementSibling.innerHTML = options.zoomRatio
    document.querySelector('input#rotateDeg').value = options.rotateDeg
    document.querySelector('input#rotateDeg').nextElementSibling.innerHTML = options.rotateDeg
    document.querySelector('input#minWidth').value = options.minWidth
    document.querySelector('input#minHeight').value = options.minHeight
  }

  async function init() {
    i18n()
    const defaultOptions = {fitMode: 'both', zoomRatio: 1.2, rotateDeg: 15, minWidth: 150, minHeight: 150}
    var {options} = await chrome.storage.sync.get('options')
    setValue(options)

    document.querySelector('input#zoomRatio').addEventListener('input', e => {
      e.target.nextElementSibling.innerHTML = e.target.value
    })
    document.querySelector('input#rotateDeg').addEventListener('input', e => {
      e.target.nextElementSibling.innerHTML = e.target.value
      e.target.nextElementSibling.nextElementSibling.style = 360 % e.target.value !== 0 ? '' : 'display:none'
    })

    document.querySelector('button#save').addEventListener('click', () => {
      options.fitMode = document.querySelector('input[name="fit"]:checked').value
      options.zoomRatio = Number(document.querySelector('input#zoomRatio').value)
      options.rotateDeg = Number(document.querySelector('input#rotateDeg').value)
      options.minWidth = Number(document.querySelector('input#minWidth').value)
      options.minHeight = Number(document.querySelector('input#minHeight').value)

      chrome.storage.sync.set({options: options}, () => {
        console.log('Options have been save.')
        console.log(options)
      })
    })

    document.querySelector('button#reset').addEventListener('click', () => {
      options = structuredClone(defaultOptions)
      setValue(options)
      chrome.storage.sync.set({options: options}, () => {
        console.log('Options have been reset to default.')
        console.log(options)
      })
    })
  }

  init()
})()
