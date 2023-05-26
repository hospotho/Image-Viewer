;(async function () {
  'use strict'

  if (window.top === window.self) return

  function createDataUrl(srcUrl) {
    return new Promise(async resolve => {
      const requests = [chrome.runtime.sendMessage({msg: 'get_local_size', url: srcUrl}), chrome.runtime.sendMessage({msg: 'get_size', url: srcUrl})]
      const [localSize, globalSize] = await Promise.all(requests)
      if (localSize || globalSize) {
        resolve(srcUrl)
        return
      }

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
        console.log(new URL(srcUrl).hostname + ' block your access outside iframe')
        resolve('')
      }

      img.crossOrigin = 'anonymous'
      img.src = srcUrl
    })
  }
  function getImageList(options) {
    const imageUrls = []
    for (const img of document.getElementsByTagName('img')) {
      const {width, height} = img.getBoundingClientRect()
      if ((width >= options.minWidth && height >= options.minHeight) || window.getComputedStyle(img).display === 'none' || !img.complete) {
        imageUrls.push(img.currentSrc)
      }
    }

    for (const node of document.querySelectorAll('*')) {
      const {width, height} = node.getBoundingClientRect()
      if (width < options.minWidth || height < options.minHeight) continue
      const backgroundImage = window.getComputedStyle(node).backgroundImage
      if (backgroundImage === 'none') continue
      const bg = backgroundImage.split(', ')[0]
      if (bg.indexOf('url') === 0 && bg.indexOf('.svg') === -1) {
        imageUrls.push(bg.substring(4, bg.length - 1).replace(/['"]/g, ''))
      }
    }

    for (const video of document.querySelectorAll('video[poster]')) {
      const {width, height} = video.getBoundingClientRect()
      if (width >= options.minWidth && height >= options.minHeight) {
        imageUrls.push(video.poster)
      }
    }

    return options.svgFilter
      ? [...new Set(imageUrls)].filter(url => url !== '' && url !== 'about:blank' && !url.includes('.svg'))
      : [...new Set(imageUrls)].filter(url => url !== '' && url !== 'about:blank')
  }

  const options = window.ImageViewerOption
  const imageList = getImageList(options)

  const asyncList = await Promise.all(imageList.map(createDataUrl))
  const imageDataUrls = asyncList.filter(url => url !== '')
  const subFrame = document.getElementsByTagName('iframe')
  const subFrameHref = [...subFrame].map(iframe => iframe.src)
  const subFrameRedirectedHref = await chrome.runtime.sendMessage({msg: 'get_redirect', data: subFrameHref})
  return [location.href, subFrameRedirectedHref, imageDataUrls]
})()
