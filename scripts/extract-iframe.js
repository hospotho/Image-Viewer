window.ImageViewerExtractor = (function () {
  'use strict'

  const safeSendMessage = function (...args) {
    if (chrome.runtime?.id) {
      return chrome.runtime.sendMessage(...args)
    }
  }

  const badImageUrlList = new Set()

  async function createDataUrl(srcUrl) {
    if (badImageUrlList.has(srcUrl)) return ''

    const localSize = await safeSendMessage({msg: 'get_local_size', url: srcUrl})
    if (localSize) return srcUrl

    return new Promise(resolve => {
      const img = new Image()
      img.onload = () => {
        const c = document.createElement('canvas')
        const ctx = c.getContext('2d')
        c.width = img.naturalWidth
        c.height = img.naturalHeight
        ctx.drawImage(img, 0, 0)
        const url = img.src.match('png') ? c.toDataURL() : img.src.match('webp') ? c.toDataURL('image/webp') : c.toDataURL('image/jpeg')
        resolve(url)
      }
      img.onerror = () => {
        badImageUrlList.add(srcUrl)
        console.log(new URL(srcUrl).hostname + ' block your access outside iframe')
        resolve('')
      }
      img.crossOrigin = 'anonymous'
      img.src = srcUrl
    })
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

      const asyncList = await Promise.all(imageList.map(createDataUrl))
      const imageDataUrls = asyncList.filter(url => url !== '')
      return [location.href, subFrameRedirectedHref, imageDataUrls]
    }
  }
})()
