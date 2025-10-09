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

  if (document.body.classList.contains('iv-attached')) return

  // init
  const options = window.ImageViewerOption
  options.closeButton = true

  // update image size filter
  const nodeInfo = await safeSendMessage('get_info')
  const [srcUrl, nodeSize] = nodeInfo
  if (nodeSize) {
    options.minWidth = Math.min(nodeSize, options.minWidth)
    options.minHeight = Math.min(nodeSize, options.minHeight)
  }

  for (let i = 0; i < 10; i++) {
    if (window.ImageViewerLastDom !== undefined) break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  const dom = window.ImageViewerLastDom
  const domRect = dom?.getBoundingClientRect()
  const domSize = domRect ? [domRect.width, domRect.height] : [0, 0]
  ImageViewerUtils.updateWrapperSize(dom, domSize, options)

  const orderedImageList = await ImageViewerUtils.getOrderedImageList(options)
  const combinedImageList = ImageViewerUtils.combineImageList(orderedImageList, window.backupImageList)
  window.backupImageList = Array.from(combinedImageList)

  // find image index
  options.index = ImageViewerUtils.searchImageInfoIndex({src: srcUrl, dom: dom}, window.backupImageList)
  if (dom && options.index === -1) {
    options.index = 0
    window.backupImageList.unshift({src: srcUrl, dom: dom})
    console.log('Unshift image to list')
  }

  // build image viewer
  ImageViewer(window.backupImageList, options)

  // auto update
  let updateRelease = () => {}
  let updatePeriod = 500
  const multiplier = 1.2

  const updateObserver = new MutationObserver(async () => {
    updatePeriod = 100
    updateRelease()
  })
  updateObserver.observe(document.body, {childList: true, subtree: true})

  while (document.body.classList.contains('iv-attached')) {
    // update image viewer
    if (dom?.tagName === 'IMG') {
      ImageViewerUtils.updateWrapperSize(dom, domSize, options)
    }
    const orderedImageList = await ImageViewerUtils.getOrderedImageList(options)
    const combinedImageList = ImageViewerUtils.combineImageList(orderedImageList, window.backupImageList)
    const currentImageList = ImageViewer('get_image_list')

    if (!document.body.classList.contains('iv-attached')) return
    if (combinedImageList.length > currentImageList.length || !ImageViewerUtils.isStrLengthEqual(combinedImageList, currentImageList)) {
      updatePeriod = 100
      window.backupImageList = Array.from(combinedImageList)
      ImageViewer(combinedImageList, options)
    }

    // wait website update
    await new Promise(resolve => {
      setTimeout(resolve, updatePeriod)
      updateRelease = resolve
      updatePeriod *= multiplier
    })

    // wait visible
    while (document.visibilityState !== 'visible') {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  updateObserver.disconnect()
})()
