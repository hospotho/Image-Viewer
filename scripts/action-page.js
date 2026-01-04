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
  window.ImageViewerLastDom = null

  const orderedImageList = await ImageViewerUtils.getOrderedImageList(options)
  const combinedImageList = ImageViewerUtils.combineImageList(orderedImageList, window.backupImageList)

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

    const expired = await ImageViewerUtils.isViewerExpired()
    if (expired) break

    // update image viewer
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
