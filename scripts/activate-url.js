;(function () {
  'use strict'

  // normal web page mode
  async function checkIframeUrl(url) {
    if (url.startsWith('blob:')) return true

    const controller = new AbortController()
    setTimeout(() => controller.abort(), 3000)
    try {
      const res = await fetch(url, {method: 'HEAD', signal: controller.signal})
      if (res.ok) {
        const options = res.headers.get('X-Frame-Options')?.toUpperCase()
        if (!options) {
          return true
        } else if (options === 'DENY') {
          return false
        } else if (options === 'SAMEORIGIN') {
          const target = new URL(res.url).origin
          const origin = new URL(location.href).origin
          return target === origin
        }
      }
    } catch (error) {}
    return false
  }
  function isNonTrivialUrl(iframe) {
    const src = iframe.src
    if (src === '' || src === 'about:blank') return false
    if (src.startsWith('javascript')) {
      iframe.classList.add('updateByTest')
      iframe.src = 'about:blank'
      return false
    }
    return true
  }
  async function removeFailedIframe() {
    const iframeList = document.querySelectorAll('iframe:not(.loadedWorker)')
    const testList = []
    for (const iframe of iframeList) {
      iframe.classList.add('loadedWorker')
      if (isNonTrivialUrl(iframe)) {
        testList.push(iframe.src)
      }
    }
    if (testList.length === 0) return

    const backgroundResult = chrome.runtime.sendMessage({msg: 'check_iframes', data: testList})
    const localResult = Promise.all(testList.map(checkIframeUrl))
    const asyncList = await Promise.all([backgroundResult, localResult])
    for (let i = 0; i < testList.length; i++) {
      const valid = asyncList[0][i] || asyncList[1][i]
      if (valid) continue

      const src = testList[i]
      const iframe = document.querySelector(`iframe[src="${src}"]`)
      if (iframe) {
        iframe.classList.add('updateByTest')
        iframe.src = 'about:blank'
        console.log(`Remove failed iframe: ${src}`)
      }
    }
  }

  async function initWorker() {
    chrome.runtime.sendMessage('load_main_worker')

    // chrome.scripting.executeScript never return on invalid iframe
    const observer = new MutationObserver(async mutationList => {
      let found = false
      for (const mutation of mutationList) {
        const target = mutation.target
        if (target.tagName !== 'IFRAME') continue
        if (target.classList.contains('updateByTest')) {
          target.classList.remove('updateByTest')
          continue
        }
        found = true
        target.classList.remove('loadedWorker')
      }
      if (!found || !document.querySelector('iframe:not(.loadedWorker)')) return
      await removeFailedIframe()
      chrome.runtime.sendMessage('get_options')
      chrome.runtime.sendMessage('load_worker')
    })
    observer.observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ['src']})

    await removeFailedIframe()
    console.log('Init content script')
    chrome.runtime.sendMessage('get_options')
    chrome.runtime.sendMessage('load_worker')

    // for some rare case
    setTimeout(async () => {
      await removeFailedIframe()
      chrome.runtime.sendMessage('get_options')
      chrome.runtime.sendMessage('load_worker')
    }, 3000)
  }

  // image url mode
  function getRawUrl(src) {
    const argsRegex = /(.*?[=.](?:jpeg|jpg|png|gif|webp|bmp|tiff|avif))(?!\/)/i
    if (src.startsWith('data')) return src
    try {
      // protocol-relative URL
      const url = new URL(src, document.baseURI)
      const baseURI = url.origin + url.pathname

      const searchList = url.search
        .slice(1)
        .split('&')
        .filter(t => t.match(argsRegex))
        .join('&')
      const imgSearch = searchList ? '?' + searchList : ''
      const noSearch = baseURI + imgSearch

      const argsMatch = noSearch.match(argsRegex)
      if (argsMatch) {
        const rawUrl = argsMatch[1]
        if (rawUrl !== src) return rawUrl
      }
    } catch (error) {}

    const argsMatch = src.match(argsRegex)
    if (argsMatch) {
      const rawUrl = argsMatch[1]
      if (rawUrl !== src) return rawUrl
    }
    return src
  }
  function getRawSize(rawUrl) {
    return new Promise(resolve => {
      const img = new Image()
      img.onload = () => resolve([img.naturalWidth, img.naturalHeight])
      img.onerror = () => resolve([0, 0])
      img.src = rawUrl
    })
  }

  async function initImageViewer(image) {
    console.log('Start image mode')

    const options = window.ImageViewerOption
    options.closeButton = false
    options.minWidth = 0
    options.minHeight = 0

    const rawUrl = getRawUrl(image.src)
    const rawSize = rawUrl === image.src ? [0, 0] : await getRawSize(rawUrl)
    const rawRatio = rawSize[0] ? rawSize[0] / rawSize[1] : 0
    const currRatio = image.naturalWidth / image.naturalHeight
    const isRawBetter = rawSize[0] > image.naturalWidth && Math.abs(rawRatio - currRatio) < 0.01

    if (typeof ImageViewer !== 'function') {
      await chrome.runtime.sendMessage('load_script')
    }
    ImageViewer([isRawBetter ? rawUrl : image.src], options)
    image.style.display = 'none'
  }

  async function init() {
    await chrome.runtime.sendMessage('get_main_options')
    // Chrome terminated service worker
    if (!window.ImageViewerOption) {
      console.log('Wait service worker ready')
    }
    while (!window.ImageViewerOption) {
      await new Promise(resolve => setTimeout(resolve, 50))
      await chrome.runtime.sendMessage('get_main_options')
    }

    const image = document.querySelector(`img[src='${location.href}']`)
    image ? initImageViewer(image) : initWorker()
  }

  if (document.visibilityState === 'visible') {
    init()
  } else {
    console.log('Waiting user to view the page')
    const handleEvent = () => {
      document.removeEventListener('visibilitychange', handleEvent)
      window.removeEventListener('focus', handleEvent)
      init()
    }
    document.addEventListener('visibilitychange', handleEvent)
    window.addEventListener('focus', handleEvent)
  }
})()
