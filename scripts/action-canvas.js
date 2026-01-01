;(async function () {
  'use strict'

  const safeSendMessage = function (...args) {
    if (chrome.runtime?.id) {
      return chrome.runtime.sendMessage(...args)
    }
  }

  if (typeof ImageViewerUtils !== 'object') {
    // url mode
    if (typeof ImageViewer === 'function') return
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

  const orderedCanvasList = await ImageViewerUtils.getOrderedCanvasList(options)
  if (orderedCanvasList.length === 0) {
    alert('No canvas found')
    return
  }

  // build image viewer
  ImageViewer(orderedCanvasList, options)
})()
