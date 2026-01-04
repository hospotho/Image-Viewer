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

  // find picked image index
  const targetData = {src: srcUrl, dom: dom}
  options.index = ImageViewerUtils.searchImageInfoIndex(targetData, combinedImageList)
  if (dom && options.index === -1) {
    combinedImageList.push(targetData)
    ImageViewerUtils.sortImageDataList(combinedImageList)
    options.index = ImageViewerUtils.searchImageInfoIndex(targetData, combinedImageList)
    console.log('Add picked image to list')
  }

  // build image viewer
  await new Promise(resolve => setTimeout(resolve, 0))
  ImageViewer(combinedImageList, options)
  window.backupImageList = combinedImageList

  // auto update
  let updateRelease = () => {}
  let updatePeriod = 500
  const multiplier = 1.2

  const updateObserver = new MutationObserver(() => {
    updatePeriod = 100
    updateRelease()
  })
  updateObserver.observe(document.body, {childList: true, subtree: true})

  while (document.body.classList.contains('iv-attached')) {
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

    // update image viewer
    if (dom?.tagName === 'IMG') {
      ImageViewerUtils.updateWrapperSize(dom, domSize, options)
    }
    const orderedImageList = await ImageViewerUtils.getOrderedImageList(options)
    const combinedImageList = ImageViewerUtils.combineImageList(orderedImageList, window.backupImageList)
    if (!document.body.classList.contains('iv-attached')) break

    const currentImageList = ImageViewer('get_image_list')
    if (combinedImageList.length > currentImageList.length || !ImageViewerUtils.isStrLengthEqual(combinedImageList, currentImageList)) {
      await new Promise(resolve => setTimeout(resolve, 0))
      ImageViewer(combinedImageList, options)
      window.backupImageList = combinedImageList
      updatePeriod = 100
    }
  }

  // cleanup
  updateObserver.disconnect()
})()
