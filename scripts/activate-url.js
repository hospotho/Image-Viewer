;(function () {
  'use strict'

  const safeSendMessage = function (...args) {
    if (chrome.runtime?.id) {
      return chrome.runtime.sendMessage(...args)
    }
  }

  let removalComplete = false

  // normal web page mode
  function isNonTrivialUrl(iframe) {
    const src = iframe.src
    if (src === '' || src === 'about:blank') {
      iframe.classList.add('updateByTest')
      return false
    }
    if (src.startsWith('javascript')) {
      iframe.classList.add('updateByTest')
      iframe.src = 'about:blank'
      return false
    }
    if (iframe.loading !== 'eager') {
      iframe.loading = 'eager'
      iframe.classList.remove('loadedWorker')
    }
    return true
  }
  async function removeFailedIframe() {
    for (const embed of document.getElementsByTagName('embed')) {
      if (embed.type === '' || embed.type === 'text/html') {
        embed.outerHTML = embed.outerHTML.replace(/^<embed(.*)>$/, '<iframe$1></iframe>')
      } else {
        embed.classList.add('loadedWorker')
      }
    }

    const iframeList = [...document.querySelectorAll('iframe:not(.loadedWorker)')]
    let found = false
    for (const iframe of iframeList) {
      iframe.classList.add('loadedWorker')
      if (isNonTrivialUrl(iframe)) {
        found = true
        break
      }
    }
    if (!found) {
      removalComplete = true
      return
    }

    const failedIframeList = (await safeSendMessage('check_frames')) || []
    for (const src of failedIframeList) {
      const targetList = iframeList.filter(iframe => iframe.src === src)
      for (const iframe of targetList) {
        if (iframe.src.startsWith('data')) continue
        const newIframe = document.createElement('iframe')
        newIframe.id = iframe.id
        newIframe.className = iframe.className
        newIframe.style = iframe.style
        newIframe.width = iframe.width
        newIframe.height = iframe.height
        newIframe.loading = iframe.loading
        newIframe.src = 'about:blank'
        iframe.parentNode.replaceChild(newIframe, iframe)
        console.log(`Remove failed iframe: ${src}`)
      }
    }
    removalComplete = true
  }
  function initIframeObserver() {
    const observer = new MutationObserver(async mutationList => {
      let found = false
      for (const mutation of mutationList) {
        const target = mutation.target
        if (target.tagName !== 'IFRAME') continue
        if (target.classList.contains('updateByTest')) {
          const {width, height} = target.getBoundingClientRect()
          if (target.id === '' && target.className.replace('loadedWorker', '') === '' && width + height === 0) {
            target.remove()
            continue
          }
          target.classList.remove('updateByTest')
          continue
        }
        found = true
        target.classList.remove('loadedWorker')
      }
      if (!found && !document.querySelector('iframe:not(.loadedWorker)') && !document.querySelector('embed:not(.loadedWorker)')) return
      if (removalComplete) {
        removalComplete = false
        await removeFailedIframe()
        safeSendMessage('get_options')
        safeSendMessage('load_worker')
      }
    })
    observer.observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ['src']})
  }

  async function initWorker() {
    safeSendMessage('load_main_worker')

    // chrome.scripting.executeScript never return on invalid iframe
    initIframeObserver()
    await removeFailedIframe()

    safeSendMessage('get_options')
    safeSendMessage('load_worker')

    // for some rare case
    setTimeout(async () => {
      await removeFailedIframe()
      safeSendMessage('get_options')
      safeSendMessage('load_worker')
    }, 3000)
  }

  // image url mode
  function getRawUrl(src) {
    const argsRegex = /(.*?[=.](?:jpeg|jpg|png|gif|webp|bmp|tiff|avif))(?!\/)/i
    if (src.startsWith('data')) return src

    const filenameMatch = src.replace(/[-_]\d{3,4}x(?:\d{3,4})?\./, '.')
    if (filenameMatch !== src) return filenameMatch

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

    await safeSendMessage('load_script')
    ImageViewer([image.src], options)

    const rawUrl = getRawUrl(image.src)
    const rawSize = rawUrl === image.src ? [0, 0] : await getRawSize(rawUrl)
    const rawRatio = rawSize[0] ? rawSize[0] / rawSize[1] : 0
    const currRatio = image.naturalWidth / image.naturalHeight
    // non trivial size or with proper ratio
    const isRawCandidate = rawSize[0] % 10 || rawSize[1] % 10 || currRatio === 1 || Math.abs(rawRatio - currRatio) < 0.01
    if (rawSize[0] >= image.naturalWidth && isRawCandidate) {
      ImageViewer('clear_image_list')
      ImageViewer([rawUrl], options)
    }
  }

  async function init() {
    await safeSendMessage('get_main_options')
    // Chrome terminated service worker
    if (!window.ImageViewerOption) {
      console.log('Wait service worker ready')
    }
    while (!window.ImageViewerOption) {
      await new Promise(resolve => setTimeout(resolve, 50))
      await safeSendMessage('get_main_options')
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
