;(async function () {
  'use strict'

  const safeSendMessage = function (...args) {
    if (chrome.runtime?.id) {
      return chrome.runtime.sendMessage(...args)
    }
  }

  if (typeof ImageViewer !== 'object') {
    await safeSendMessage('load_script')
  }

  if (document.body.classList.contains('iv-attached')) {
    ImageViewer('close_image_viewer')
    return
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

  // init
  const options = window.ImageViewerOption
  options.closeButton = true
  options.minWidth = 0
  options.minHeight = 0
  window.ImageViewerLastDom = null

  // build image viewer
  const canvasDataList = deepQuerySelectorAll(document.body, 'CANVAS', 'canvas')
    .map(canvas => ({src: canvas.toDataURL(), dom: canvas}))
    .filter(data => data.src !== 'data:,')
  ImageViewer(canvasDataList, options)
})()
