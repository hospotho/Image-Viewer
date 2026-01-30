;(function () {
  'use strict'

  const zoom = document.querySelector('input#zoomRatio')
  const rotate = document.querySelector('input#rotateDeg')

  const width = document.querySelector('input#minWidth')
  const height = document.querySelector('input#minHeight')
  const svgFilter = document.querySelector('input#svgFilter')

  const debounce = document.querySelector('input#debouncePeriod')
  const throttle = document.querySelector('input#throttlePeriod')
  const auto = document.querySelector('input#autoPeriod')

  const google = document.querySelector('input#googleSearch')
  const yandex = document.querySelector('input#yandexSearch')
  const sauceNAO = document.querySelector('input#sauceNAOSearch')
  const ascii2d = document.querySelector('input#ascii2dSearch')
  const useAll = document.querySelector('input#useAllSearch')

  const scrollHotkey = document.querySelector('input#scrollHotkey')
  const downloadHotkey = document.querySelector('input#downloadHotkey')

  const hoverCheck = document.querySelector('textarea#hoverCheckDisableList')
  const autoScroll = document.querySelector('textarea#autoScrollEnableList')
  const imageUnlazy = document.querySelector('textarea#imageUnlazyDisableList')
  const imageCache = document.querySelector('textarea#imageCacheDisableList')

  const defaultOptions = {
    fitMode: 'both',
    zoomRatio: 1.2,
    rotateDeg: 15,
    minWidth: 180,
    minHeight: 150,
    svgFilter: true,
    debouncePeriod: 1500,
    throttlePeriod: 80,
    autoPeriod: 2000,
    searchHotkey: ['Shift + Q', 'Shift + W', 'Shift + A', 'Shift + S', 'Ctrl + Shift + Q', ''],
    customUrl: ['https://example.com/search?query={imgSrc}&option=example_option'],
    functionHotkey: ['Shift + R', 'Shift + D'],
    hoverCheckDisableList: [],
    autoScrollEnableList: ['x.com', 'www.instagram.com', 'www.facebook.com'],
    imageUnlazyDisableList: [],
    imageCacheDisableList: []
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
      alert('Options have been reset to default.')
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
    const last = custom[custom.length - 1]
    const li = last.parentNode

    const i18n = [chrome.i18n.getMessage('custom_search'), chrome.i18n.getMessage('custom_search_url')]
    const htmlStr =
      `<li><label for="customSearch${length + 1}"><span>${i18n[0]}</span> ${length + 1}:</label><input id="customSearch${length + 1}" class="customSearch hotkey"></li>` +
      `<li><label for="customSearchUrl${length + 1}"><span>${i18n[1]}</span> ${length + 1}:</label><input id="customSearch${length + 1}" class="customSearchUrl"></li>`
    li.insertAdjacentHTML('afterend', htmlStr)

    for (const input of document.querySelectorAll('input.hotkey')) {
      input.addEventListener('keydown', e => {
        e.preventDefault()
        input.value = keyToString(e)
      })
    }
  }

  function setValue(options) {
    try {
      document.querySelector(`input#fit-${options.fitMode}`).checked = true
      zoom.value = options.zoomRatio
      zoom.nextElementSibling.textContent = options.zoomRatio
      rotate.value = options.rotateDeg
      rotate.nextElementSibling.textContent = options.rotateDeg

      width.value = options.minWidth
      height.value = options.minHeight
      svgFilter.checked = options.svgFilter

      debounce.value = options.debouncePeriod
      throttle.value = options.throttlePeriod
      auto.value = options.autoPeriod

      google.value = options.searchHotkey[0]
      yandex.value = options.searchHotkey[1]
      sauceNAO.value = options.searchHotkey[2]
      ascii2d.value = options.searchHotkey[3]
      useAll.value = options.searchHotkey[4]

      for (let i = 6; i < options.searchHotkey.length; i++) {
        addNewCustom()
      }
      const custom = document.querySelectorAll('input.customSearch')
      const customUrl = document.querySelectorAll('input.customSearchUrl')
      for (let i = 0; i < custom.length; i++) {
        if (i < options.searchHotkey.length - 5) {
          custom[i].value = options.searchHotkey[i + 5]
          customUrl[i].value = options.customUrl[i]
        } else {
          custom[i].value = ''
          customUrl[i].value = ''
        }
      }

      scrollHotkey.value = options.functionHotkey[0]
      downloadHotkey.value = options.functionHotkey[1]

      hoverCheck.value = options.hoverCheckDisableList.join('\n')
      autoScroll.value = options.autoScrollEnableList.join('\n')
      imageUnlazy.value = options.imageUnlazyDisableList.join('\n')
      imageCache.value = options.imageCacheDisableList.join('\n')
    } catch (e) {
      resetDefaultOptions()
      setValue(defaultOptions)
      alert('Failed to use existing options')
    }
  }

  //==========main==========
  function checkUpdate(options) {
    const newOptionList = Object.keys(defaultOptions).filter(key => !(key in options))
    if (newOptionList.length === 0) return

    const message = newOptionList
      .map(key => key.replace(/([A-Z])/g, '_$1').toLowerCase())
      .map(tag => chrome.i18n.getMessage(tag) || tag)
      .join('\n')
    alert(chrome.i18n.getMessage('new_option') + ':\n' + message)

    // sync with default options
    for (const key of newOptionList) {
      options[key] = defaultOptions[key]
    }
    chrome.storage.sync.set({options: options}, () => {
      if (chrome.runtime?.id) chrome.runtime.sendMessage('update_options')
      console.log(options)
    })
  }

  function initFormEvent() {
    zoom.addEventListener('input', () => {
      document.querySelector('span#zoomDisplay').textContent = zoom.value
    })

    rotate.addEventListener('input', () => {
      const span = document.querySelector('span#rotateDisplay')
      span.textContent = rotate.value
      span.nextElementSibling.style = 360 % rotate.value !== 0 ? 'display: inline' : ''
    })

    const debounceDesc = document.querySelector('li#debounceDesc')
    debounce.addEventListener('focus', () => (debounceDesc.style = 'display: block; padding: 0px 0px 10px 10px;'))
    debounce.addEventListener('focusout', () => (debounceDesc.style = ''))

    const throttleDesc = document.querySelector('li#throttleDesc')
    throttle.addEventListener('focus', () => (throttleDesc.style = 'display: block; padding: 0px 0px 10px 10px;'))
    throttle.addEventListener('focusout', () => (throttleDesc.style = ''))

    const autoDesc = document.querySelector('li#autoDesc')
    auto.addEventListener('focus', () => (autoDesc.style = 'display: block; padding: 0px 0px 10px 10px;'))
    auto.addEventListener('focusout', () => (autoDesc.style = ''))

    for (const input of document.querySelectorAll('input.hotkey')) {
      input.addEventListener('keydown', e => {
        e.preventDefault()
        input.value = keyToString(e)
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
      options.autoPeriod = Number(auto.value)

      const hotkeyList = [google.value, yandex.value, sauceNAO.value, ascii2d.value, useAll.value]
      const customUrlList = []
      const custom = document.querySelectorAll('input.customSearch')
      const customUrl = document.querySelectorAll('input.customSearchUrl')
      for (let i = 0; i < custom.length; i++) {
        if (!custom[i].value && !customUrl[i].value) continue
        hotkeyList.push(custom[i].value)
        customUrlList.push(customUrl[i].value)
      }
      options.searchHotkey = hotkeyList
      options.customUrl = customUrlList

      options.functionHotkey = [scrollHotkey.value, downloadHotkey.value]

      const hoverCheckDisableList = hoverCheck.value.split('\n')
      const autoScrollEnableList = autoScroll.value.split('\n')
      const imageUnlazyDisableList = imageUnlazy.value.split('\n')
      const imageCacheDisableList = imageCache.value.split('\n')
      options.hoverCheckDisableList = hoverCheckDisableList
      options.autoScrollEnableList = autoScrollEnableList
      options.imageUnlazyDisableList = imageUnlazyDisableList
      options.imageCacheDisableList = imageCacheDisableList

      chrome.storage.sync.set({options: options}, () => {
        if (chrome.runtime?.id) chrome.runtime.sendMessage('update_options')
        console.log(options)
        alert('Options have been saved.')
      })
    })

    document.querySelector('button#reset').addEventListener('click', () => {
      setValue(defaultOptions)
      resetDefaultOptions()
    })
  }

  async function init() {
    i18n()
    const {options} = await chrome.storage.sync.get('options')
    checkUpdate(options)
    setValue(options)
    initFormEvent()
    initFormButton()
  }

  init()
})()
