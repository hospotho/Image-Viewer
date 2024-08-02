window.ImageViewerExtractor = (function () {
  'use strict'

  const safeSendMessage = function (...args) {
    if (chrome.runtime?.id) {
      return chrome.runtime.sendMessage(...args)
    }
  }

  function getImageList(options) {
    const minWidth = options.minWidth || 0
    const minHeight = options.minHeight || 0
    const imageUrls = []
    for (const img of document.getElementsByTagName('img')) {
      const {width, height} = img.getBoundingClientRect()
      if ((width >= minWidth && height >= minHeight) || window.getComputedStyle(img).display === 'none' || !img.complete) {
        imageUrls.push(img.currentSrc)
      }
    }

    for (const node of document.body.getElementsByTagName('*')) {
      const {width, height} = node.getBoundingClientRect()
      if (width < minWidth || height < minHeight) continue
      const backgroundImage = window.getComputedStyle(node).backgroundImage
      if (backgroundImage === 'none') continue
      const bgList = backgroundImage.split(', ').filter(bg => bg.startsWith('url') && !bg.endsWith('.svg")'))
      if (bgList.length !== 0) {
        imageUrls.push(bgList[0].slice(5, -2))
      }
    }

    for (const video of document.querySelectorAll('video[poster]')) {
      const {width, height} = video.getBoundingClientRect()
      if (width >= minWidth && height >= minHeight) {
        imageUrls.push(video.poster)
      }
    }

    return options.svgFilter
      ? [...new Set(imageUrls)].filter(url => url !== '' && url !== 'about:blank' && !url.includes('.svg'))
      : [...new Set(imageUrls)].filter(url => url !== '' && url !== 'about:blank')
  }

  return {
    extractImage: async function (options) {
      const subFrame = document.getElementsByTagName('iframe')
      const subFrameHref = [...subFrame].map(iframe => iframe.src)
      const subFrameRedirectedHref = subFrameHref.length ? await safeSendMessage({msg: 'get_redirect', data: subFrameHref}) : []

      const imageList = getImageList(options)
      if (imageList.length === 0) return [location.href, subFrameRedirectedHref, []]

      const asyncList = await Promise.all(imageList.map(src => safeSendMessage({msg: 'get_local_url', url: src})))
      const imageDataUrls = asyncList.filter(url => url !== '')
      return [location.href, subFrameRedirectedHref, imageDataUrls]
    }
  }
})()
