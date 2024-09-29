;(async function () {
  'use strict'

  const safeSendMessage = function (...args) {
    if (chrome.runtime?.id) {
      return chrome.runtime.sendMessage(...args)
    }
  }

  if (typeof ImageViewerUtils !== 'object') {
    await safeSendMessage('load_utility')
  }

  if (document.body.classList.contains('iv-attached')) {
    ImageViewer('close_image_viewer')
    return
  }

  // init
  const options = window.ImageViewerOption
  options.closeButton = true
  options.canvasMode = true
  window.ImageViewerLastDom = null

  // build image viewer
  const filteredCanvasList = ImageViewerUtils.deepQuerySelectorAll(document.body, 'CANVAS', 'canvas')
    .filter(canvas => canvas.clientWidth > options.minWidth && canvas.clientHeight > options.minHeight)
    .map(canvas => ({src: canvas.toDataURL(), dom: canvas}))
    .filter(data => data.src !== 'data:,')
  const iframeCanvasList = await ImageViewerUtils.getIframeImageList(options)
  const orderedCanvasList = ImageViewerUtils.combineImageList(filteredCanvasList, iframeCanvasList)
  ImageViewer(orderedCanvasList, options)
})()
