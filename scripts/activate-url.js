;(function () {
  'use strict'

  const init = async () => {
    if (document.body.children.length === 1 && document.body.children[0].tagName === 'IMG') {
      const image = document.body.children[0]

      await chrome.runtime.sendMessage('get_options')
      const options = window.ImageViewerOption
      options.closeButton = false
      options.minWidth = 0
      options.minHeight = 0

      const getRawUrl = src => {
        const argsRegex = /(.*?(?:png|jpeg|jpg|gif|bmp|tiff|webp)).*/i
        const argsMatch = !src.startsWith('data') && src.match(argsRegex)
        if (argsMatch) {
          const rawUrl = argsMatch[1]
          if (rawUrl !== src) return rawUrl
        }
        try {
          const url = new URL(src)
          const noSearch = url.origin + url.pathname
          if (noSearch !== src) return noSearch
        } catch (error) {}
        return src
      }

      const rawUrl = getRawUrl(image.src)
      if (rawUrl !== image.src) {
        const currSize = image.naturalWidth
        const rawSize = await new Promise(resolve => {
          const img = new Image()
          img.onload = () => resolve(img.naturalWidth)
          img.onerror = () => resolve(0)
          img.src = rawUrl
        })

        if (rawSize > currSize) {
          await chrome.runtime.sendMessage('load_script')
          image.style.display = 'none'
          imageViewer([rawUrl], options)
          return
        }
      }

      await chrome.runtime.sendMessage('load_script')
      image.style.display = 'none'
      imageViewer([image.src], options)
      return
    }

    // chrome.scripting.executeScript never return on invalid iframe
    const safeHref = 'about:blank'
    const iframeList = document.querySelectorAll('iframe')
    for (const iframe of iframeList) {
      if (iframe.src.startsWith('javascript')) {
        iframe.src = safeHref
      }
      iframe.classList.add('loadedWorker')
      iframe.classList.add('safeHref')
    }

    console.log('Init content script.')
    chrome.runtime.sendMessage('load_worker')

    const observer = new MutationObserver(() => {
      const newIframeList = document.querySelectorAll('iframe:not(.loadedWorker)')
      if (newIframeList.length === 0) return

      const iframeList = document.querySelectorAll('iframe:not(.safeHref)')
      for (const iframe of iframeList) {
        if (iframe.src.startsWith('javascript')) {
          iframe.src = safeHref
        }
        iframe.classList.add('safeHref')
      }

      console.log('New iframe')
      chrome.runtime.sendMessage('load_worker')
      for (const iframe of newIframeList) {
        iframe.classList.add('loadedWorker')
      }
    })

    observer.observe(document.documentElement, {childList: true, subtree: true})
    // for some rare case
    setTimeout(() => chrome.runtime.sendMessage('load_worker'), 3000)
  }

  if (document.visibilityState === 'visible') {
    init()
  } else {
    console.log('Waiting user to view the page.')
    const handleEvent = () => {
      document.removeEventListener('visibilitychange', handleEvent)
      window.removeEventListener('focus', handleEvent)
      init()
    }
    document.addEventListener('visibilitychange', handleEvent)
    window.addEventListener('focus', handleEvent)
  }
})()
