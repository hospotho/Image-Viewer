;(function () {
  'use strict'

  const zoom = document.querySelector('input#zoomRatio')
  const rotate = document.querySelector('input#rotateDeg')

  const width = document.querySelector('input#minWidth')
  const height = document.querySelector('input#minHeight')
  const svgFilter = document.querySelector('input#svgFilter')

  const debounce = document.querySelector('input#debouncePeriod')
  const throttle = document.querySelector('input#throttlePeriod')

  const google = document.querySelector('input#googleSearch')
  const yandex = document.querySelector('input#yandexSearch')
  const sauceNAO = document.querySelector('input#sauceNAOSearch')
  const ascii2d = document.querySelector('input#ascii2dSearch')
  const useAll = document.querySelector('input#useAllSearch')

  const defaultOptions = {
    fitMode: 'both',
    zoomRatio: 1.2,
    rotateDeg: 15,
    minWidth: 150,
    minHeight: 150,
    svgFilter: true,
    debouncePeriod: 1500,
    throttlePeriod: 80,
    hotkey: ['Shift + Q', 'Shift + W', 'Shift + E', 'Shift + R', 'Ctrl + Alt + Q', ''],
    customUrl: ['https://example.com/search?query={imgSrc}&option=example_option']
  }

  //==========utility==========
  function i18n() {
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
      el.innerHTML = message
      if (el.value !== '') el.value = message
    }
  }

  function resetDefaultOptions() {
    chrome.storage.sync.set({options: defaultOptions}, () => {
      console.log('Options have been reset to default.')
      console.log(defaultOptions)
    })
  }

  function keyToString(e) {
    let result = ''
    if (e.ctrlKey) result += 'Ctrl + '
    if (e.altKey) result += 'Alt + '
    if (e.shiftKey) result += 'Shift + '
    if (result !== '' && /^[\S]{1}$/.test(e.key)) {
      result += e.key.toUpperCase()
    }
    return result
  }

  function addNewCustom() {
    const custom = document.querySelectorAll('input.customSearchUrl')
    const length = custom.length
    const last = custom[length - 1]
    const tr = last.parentNode.parentNode

    const i18n = [chrome.i18n.getMessage('custom_search'), chrome.i18n.getMessage('custom_search_url')]
    const htmlStr =
      `<li><label for="customSearch${length + 1}"><span>${i18n[0]}</span> ${length + 1}:</label><input id="customSearch${length + 1}" class="customSearch hotkey"></li>` +
      `<li><label for="customSearchUrl${length + 1}"><span>${i18n[1]}</span> ${length + 1}:</label><input id="customSearch${length + 1}" class="customSearchUrl"></li>`
    tr.insertAdjacentHTML('afterend', htmlStr)

    for (const input of document.querySelectorAll('input.hotkey')) {
      input.addEventListener('keydown', e => {
        e.preventDefault()
        e.target.value = keyToString(e)
      })
    }
  }

  function setValue(options) {
    try {
      document.querySelector(`input#fit-${options.fitMode}`).checked = true
      zoom.value = options.zoomRatio
      zoom.nextElementSibling.innerHTML = options.zoomRatio
      rotate.value = options.rotateDeg
      rotate.nextElementSibling.innerHTML = options.rotateDeg

      width.value = options.minWidth
      height.value = options.minHeight
      svgFilter.checked = options.svgFilter

      debounce.value = options.debouncePeriod
      throttle.value = options.throttlePeriod

      google.value = options.hotkey[0]
      yandex.value = options.hotkey[1]
      sauceNAO.value = options.hotkey[2]
      ascii2d.value = options.hotkey[3]
      useAll.value = options.hotkey[4]

      for (let i = 6; i < options.hotkey.length; i++) {
        addNewCustom()
      }
      const custom = [...document.querySelectorAll('input.customSearch')]
      const customUrl = [...document.querySelectorAll('input.customSearchUrl')]
      for (let i = 0; i < custom.length; i++) {
        if (i < options.hotkey.length - 5) {
          custom[i].value = options.hotkey[i + 5]
          customUrl[i].value = options.customUrl[i]
        } else {
          custom[i].value = ''
          customUrl[i].value = ''
        }
      }
    } catch (e) {
      console.log(e)
      alert('Failed to use existing options')
      resetDefaultOptions()
      setValue(defaultOptions)
    }
  }

  //==========main==========
  function initFormEvent() {
    zoom.addEventListener('input', e => {
      document.querySelector('span#zoomDisplay').innerHTML = e.target.value
    })

    rotate.addEventListener('input', e => {
      const span = document.querySelector('span#rotateDisplay')
      span.innerHTML = e.target.value
      span.nextElementSibling.style = 360 % e.target.value !== 0 ? 'display: inline' : ''
    })

    const debounceDesc = document.querySelector('li#debounceDesc')
    debounce.addEventListener('focus', () => (debounceDesc.style = 'display: block; padding: 0px 0px 10px 10px;'))
    debounce.addEventListener('focusout', () => (debounceDesc.style = ''))

    const throttleDesc = document.querySelector('li#throttleDesc')
    throttle.addEventListener('focus', () => (throttleDesc.style = 'display: block; padding: 0px 0px 10px 10px;'))
    throttle.addEventListener('focusout', () => (throttleDesc.style = ''))

    for (const input of document.querySelectorAll('input.hotkey')) {
      input.addEventListener('keydown', e => {
        e.preventDefault()
        e.target.value = keyToString(e)
      })
    }

    document.querySelector('button#addNewCustom').addEventListener('click', addNewCustom)
  }

  function initFormButton() {
    document.querySelector('button#save').addEventListener('click', () => {
      const options = {}
      options.fitMode = document.querySelector('input[name="fit"]:checked').value
      options.zoomRatio = Number(zoom.value)
      options.rotateDeg = Number(rotate.value)
      options.minWidth = Number(width.value)
      options.minHeight = Number(height.value)
      options.svgFilter = svgFilter.checked
      options.debouncePeriod = Number(debounce.value)
      options.throttlePeriod = Number(throttle.value)

      const hotkeyList = [google.value, yandex.value, sauceNAO.value, ascii2d.value, useAll.value]
      const customUrlList = []
      const custom = [...document.querySelectorAll('input.customSearch')]
      const customUrl = [...document.querySelectorAll('input.customSearchUrl')]
      for (let i = 0; i < custom.length; i++) {
        if (!custom[i].value && !customUrl[i].value) continue
        hotkeyList.push(custom[i].value)
        customUrlList.push(customUrl[i].value)
      }
      options.hotkey = hotkeyList
      options.customUrl = customUrlList

      chrome.storage.sync.set({options: options}, () => {
        console.log('Options have been save.')
        console.log(options)
        chrome.runtime.sendMessage('update_options')
      })
    })

    document.querySelector('button#reset').addEventListener('click', () => {
      setValue(defaultOptions)
      resetDefaultOptions()
    })

    document.querySelector('button#save').click()
  }

  async function init() {
    i18n()
    const {options} = await chrome.storage.sync.get('options')
    setValue(options)
    initFormEvent()
    initFormButton()
  }

  init()
})()
