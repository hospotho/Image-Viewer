window.ImageViewerExtractor = (function () {
  'use strict'

  window.srcBitSizeMap ??= new Map()
  const srcRealSizeMap = window.srcRealSizeMap

  async function getImageRealSize(src) {
    const cache = srcRealSizeMap.get(src)
    if (cache !== undefined) return cache

    const promise = new Promise(_resolve => {
      const resolve = size => {
        srcRealSizeMap.set(src, size)
        _resolve(size)
      }

      const img = new Image()
      img.onload = () => resolve(Math.min(img.naturalWidth, img.naturalHeight))
      img.onerror = () => resolve(0)
      setTimeout(() => img.complete || resolve(0), 10000)
      img.src = src
    })

    srcRealSizeMap.set(src, promise)
    return promise
  }
  async function checkBackgroundSize(node, url) {
    const realSize = await getImageRealSize(url)
    const {width, height} = node.getBoundingClientRect()
    node.removeAttribute('no-bg')
    node.setAttribute('iv-bg', url)
    node.setAttribute('iv-width', Math.min(realSize, width))
    node.setAttribute('iv-height', Math.min(realSize, height))
  }
  function getNodeSize(node) {
    const widthAttr = node.getAttribute('iv-width')
    const heightAttr = node.getAttribute('iv-height')
    if (widthAttr && heightAttr) {
      const width = Number(widthAttr)
      const height = Number(heightAttr)
      return [width, height]
    }
    const {width, height} = node.getBoundingClientRect()
    if (width === 0 || height === 0) {
      node.setAttribute('no-bg', '')
    }
    node.setAttribute('iv-width', width)
    node.setAttribute('iv-height', height)
    return [width, height]
  }
  function deepQuerySelectorAll(target, selector) {
    const result = []
    const stack = [target]
    while (stack.length) {
      const current = stack.pop()
      // check shadowRoot
      for (const node of current.querySelectorAll('*:not([no-shadow])')) {
        if (node.shadowRoot) {
          stack.push(node.shadowRoot)
        } else {
          node.setAttribute('no-shadow', '')
        }
      }
      result.push(...current.querySelectorAll(selector))
    }
    return result
  }
  function getImageList(options) {
    const minWidth = options.minWidth || 0
    const minHeight = options.minHeight || 0
    const imageList = []

    const rawImageList = deepQuerySelectorAll(document.body, 'img')
    for (const img of rawImageList) {
      // only client size should be checked in order to bypass large icon or hidden image
      const {width, height} = img.getBoundingClientRect()
      if ((width >= minWidth && height >= minHeight) || img === window.ImageViewerLastDom) {
        // currentSrc might be empty during unlazy or update
        const imgSrc = img.currentSrc || img.src
        imageList.push(imgSrc)
      }
    }

    const videoList = deepQuerySelectorAll(document.body, 'video[poster]')
    for (const video of videoList) {
      const {width, height} = video.getBoundingClientRect()
      if (width >= minWidth && height >= minHeight) {
        imageList.push(video.poster)
      }
    }

    const uncheckedNodeList = deepQuerySelectorAll(document.body, '*:not([no-bg])')
    if (!document.body.hasAttribute('no-bg')) uncheckedNodeList.unshift(document.body)
    for (const node of uncheckedNodeList) {
      const [width, height] = getNodeSize(node)
      if (width < minWidth || height < minHeight) continue
      const attrUrl = node.getAttribute('iv-bg')
      if (attrUrl !== null) {
        imageList.push(attrUrl)
        continue
      }
      const backgroundImage = window.getComputedStyle(node).backgroundImage
      if (backgroundImage === 'none') {
        node.setAttribute('no-bg', '')
        continue
      }
      const bgList = backgroundImage.split(', ').filter(bg => bg.startsWith('url') && !bg.endsWith('.svg")'))
      if (bgList.length === 0) {
        node.setAttribute('no-bg', '')
        continue
      }
      const url = bgList[0].slice(5, -2)
      node.setAttribute('no-bg', '')
      checkBackgroundSize(node, url)
    }

    return options.svgFilter
      ? [...new Set(imageList)].filter(url => url !== '' && url !== 'about:blank' && !url.includes('.svg'))
      : [...new Set(imageList)].filter(url => url !== '' && url !== 'about:blank')
  }
  function getCanvasList(options) {
    const minWidth = options.minWidth || 0
    const minHeight = options.minHeight || 0
    const canvasList = []

    const rawCanvasList = deepQuerySelectorAll(document.body, 'canvas')
    for (const canvas of rawCanvasList) {
      const {width, height} = canvas.getBoundingClientRect()
      if (width >= minWidth && height >= minHeight) {
        const dataUrl = canvas.toDataURL()
        if (dataUrl === 'data:,') continue
        canvasList.push(dataUrl)
      }
    }
    return canvasList
  }

  return {
    extractImage: async function (options) {
      const imageList = options.canvasMode ? getCanvasList(options) : getImageList(options)
      return imageList
    }
  }
})()
