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

  for (let i = 0; i < 10; i++) {
    if (window.ImageViewerLastDom !== undefined) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }

  // update image size filter
  const nodeInfo = await safeSendMessage('get_info')
  const [_, nodeSize] = nodeInfo
  options.minWidth = Math.min(nodeSize, options.minWidth)
  options.minHeight = Math.min(nodeSize, options.minHeight)

  const orderedCanvasList = await ImageViewerUtils.getOrderedCanvasList(options)
  if (orderedCanvasList.length === 0) {
    alert('No canvas found')
    return
  }

  const canvas = window.ImageViewerLastDom
  if (canvas?.tagName === 'CANVAS') {
    const targetData = {src: '', dom: canvas}
    options.index = ImageViewerUtils.searchImageInfoIndex(targetData, orderedCanvasList)
  }

  // build image viewer
  ImageViewer(orderedCanvasList, options)
})()
