;(async function () {
  'use strict'

  if (window.top === window.self) return

  function createDataUrl(srcUrl) {
    return new Promise(resolve => {
      const img = new Image()

      img.onload = () => {
        const c = document.createElement('canvas')
        const ctx = c.getContext('2d')
        c.width = img.naturalWidth
        c.height = img.naturalHeight
        ctx.drawImage(img, 0, 0)
        const url = img.src.match('png') ? c.toDataURL() : c.toDataURL('image/jpeg')
        resolve(url)
      }
      img.onerror = () => {
        console.log(new URL(src).hostname + ' block your access outside iframe')
        resolve('')
      }

      img.crossOrigin = 'anonymous'
      img.src = srcUrl
    })
  }
  function getImageList(options) {
    const imageUrls = []
    for (const img of document.getElementsByTagName('img')) {
      if ((img.clientWidth >= options.minWidth && img.clientHeight >= options.minHeight) || !img.complete) {
        imageUrls.push(img.currentSrc)
      }
    }

    for (const node of document.querySelectorAll('*')) {
      if (node.clientWidth < options.minWidth || node.clientWidth < options.minHeight) continue
      const bg = window.getComputedStyle(node).backgroundImage
      if (bg?.indexOf('url') === 0 && bg.indexOf('.svg') === -1) {
        imageUrls.push(bg.substring(4, bg.length - 1).replace(/['"]/g, ''))
      }
    }

    for (const video of document.querySelectorAll('video[poster]')) {
      if (video.clientWidth >= options.minWidth && video.clientHeight >= options.minHeight) {
        imageUrls.push(video.poster)
      }
    }

    return options.svgFilter
      ? [...new Set(imageUrls)].filter(url => url !== '' && url !== 'about:blank' && !url.includes('.svg'))
      : [...new Set(imageUrls)].filter(url => url !== '' && url !== 'about:blank')
  }

  const options = window.ImageViewerOption
  const imageList = getImageList(options)

  const asyncList = []
  for (const url of imageList) {
    asyncList.push(createDataUrl(url))
  }
  const imageDataUrls = (await Promise.all(asyncList)).filter(url => url !== '')
  return imageDataUrls.length ? imageDataUrls : null
})()
