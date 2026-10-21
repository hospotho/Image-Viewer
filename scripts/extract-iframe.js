window.ImageViewerExtractor = (function () {
  'use strict'

  function isNodeSizeEnough(node, minWidth, minHeight) {
    const widthAttr = node.getAttribute('iv-width')
    const heightAttr = node.getAttribute('iv-height')
    if (widthAttr && heightAttr) {
      const width = Number(widthAttr)
      const height = Number(heightAttr)
      return width >= minWidth && height >= minHeight
    }
    const {width, height} = node.getBoundingClientRect()
    if (width === 0 || height === 0) {
      node.setAttribute('no-bg', '')
      return false
    }
    node.setAttribute('iv-width', width)
    node.setAttribute('iv-height', height)
    return width >= minWidth && height >= minHeight
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
    if (!document.body.hasAttribute('no-bg')) uncheckedNodeList.push(document.body)
    for (const node of uncheckedNodeList) {
      if (!isNodeSizeEnough(node, minWidth, minHeight)) continue
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
      node.setAttribute('iv-bg', url)
      imageList.push(url)
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
