window.ImageViewerExtractor = (function () {
  'use strict'

  const safeSendMessage = function (...args) {
    if (chrome.runtime?.id) {
      return chrome.runtime.sendMessage(...args)
    }
  }

  function isNodeSizeEnough(node, minWidth, minHeight) {
    const widthAttr = node.getAttribute('data-width')
    const heightAttr = node.getAttribute('data-height')
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
    node.setAttribute('data-width', width)
    node.setAttribute('data-height', height)
    return width >= minWidth && height >= minHeight
  }
  function deepQuerySelectorAll(target, tagName, selector) {
    const result = []
    const stack = [target]
    while (stack.length) {
      const current = stack.pop()
      for (const node of current.querySelectorAll(`${selector}, *:not([no-shadow])`)) {
        if (node.tagName === tagName) result.push(node)
        if (node.shadowRoot) {
          stack.push(node.shadowRoot)
        } else {
          node.setAttribute('no-shadow', '')
        }
      }
    }
    return result
  }
  function getImageList(options) {
    const minWidth = options.minWidth || 0
    const minHeight = options.minHeight || 0
    const imageList = []

    const rawImageList = deepQuerySelectorAll(document.body, 'IMG', 'img')
    for (const img of rawImageList) {
      // only client size should be checked in order to bypass large icon or hidden image
      const {width, height} = img.getBoundingClientRect()
      if ((width >= minWidth && height >= minHeight) || img === window.ImageViewerLastDom) {
        // currentSrc might be empty during unlazy or update
        const imgSrc = img.currentSrc || img.src
        imageList.push(imgSrc)
      }
    }

    const videoList = document.querySelectorAll('video[poster]')
    for (const video of videoList) {
      const {width, height} = video.getBoundingClientRect()
      if (width >= minWidth && height >= minHeight) {
        imageList.push(video.poster)
      }
    }

    const uncheckedNodeList = document.body.querySelectorAll('*:not([no-bg]):not(img):not(video[poster])')
    for (const node of uncheckedNodeList) {
      if (!isNodeSizeEnough(node, minWidth, minHeight)) continue
      const attrUrl = node.getAttribute('data-bg')
      if (attrUrl !== null) {
        imageList.push(attrUrl)
        continue
      }
      const nodeStyle = window.getComputedStyle(node)
      const backgroundImage = nodeStyle.backgroundImage
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
      node.setAttribute('data-bg', url)
      imageList.push(url)
    }

    return options.svgFilter
      ? [...new Set(imageList)].filter(url => url !== '' && url !== 'about:blank' && !url.includes('.svg'))
      : [...new Set(imageList)].filter(url => url !== '' && url !== 'about:blank')
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
