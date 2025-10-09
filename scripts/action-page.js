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
  window.ImageViewerLastDom = null

  const orderedImageList = await ImageViewerUtils.getOrderedImageList(options)
  const combinedImageList = ImageViewerUtils.combineImageList(orderedImageList, window.backupImageList)
  window.backupImageList = Array.from(combinedImageList)

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
