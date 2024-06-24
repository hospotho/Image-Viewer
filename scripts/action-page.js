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

  if (document.documentElement.classList.contains('has-image-viewer')) {
    ImageViewer('close_image_viewer')
    return
  }

  // init
  const options = window.ImageViewerOption
  options.closeButton = true
  options.referrerPolicy = !!document.querySelector('img[referrerPolicy="no-referrer"]')
  options.cors = !!document.querySelector('img[crossorigin="anonymous"]')
  document.querySelector('.ImageViewerLastDom')?.classList.remove('ImageViewerLastDom')
  window.backupImageUrlList ??= []

  const orderedImageUrls = await ImageViewerUtils.getOrderedImageUrls(options)
  const combinedImageList = ImageViewerUtils.combineImageList(orderedImageUrls, window.backupImageUrlList)
  window.backupImageUrlList = Array.from(combinedImageList)

  ImageViewer(window.backupImageUrlList, options)

  // auto update
  let initComplete = true
  let initPeriod = 500
  let updatePeriod = 500
  let updateRelease = () => {}
  const multiplier = 1.2

  const initObserver = new MutationObserver(mutationList => {
    initComplete = !mutationList.some(mutation => mutation.addedNodes.length)
  })
  initObserver.observe(document.documentElement, {childList: true, subtree: true})

  const updateObserver = new MutationObserver(async () => {
    const container = ImageViewerUtils.getMainContainer()
    let currentScrollX = container.scrollLeft
    let currentScrollY = container.scrollTop
    await new Promise(resolve => setTimeout(resolve, 50))
    // check scroll complete
    while (currentScrollX !== container.scrollLeft || currentScrollY !== container.scrollTop) {
      currentScrollX = container.scrollLeft
      currentScrollY = container.scrollTop
      await new Promise(resolve => setTimeout(resolve, 300))
    }
    updatePeriod = 500
    updateRelease()
  })
  updateObserver.observe(document.documentElement, {childList: true, subtree: true})

  while (document.documentElement.classList.contains('has-image-viewer')) {
    // wait website init
    await new Promise(resolve => setTimeout(resolve, initPeriod))
    while (!initComplete) {
      initComplete = true
      await new Promise(resolve => setTimeout(resolve, initPeriod))
    }
    if (!document.documentElement.classList.contains('has-image-viewer')) return

    // update image viewer
    const orderedImageUrls = await ImageViewerUtils.getOrderedImageUrls(options)
    const combinedImageList = ImageViewerUtils.combineImageList(orderedImageUrls, window.backupImageUrlList)
    const currentImageList = ImageViewer('get_image_list')

    if (!document.documentElement.classList.contains('has-image-viewer')) return
    if (combinedImageList.length > currentImageList.length || !ImageViewerUtils.isStrLengthEqual(combinedImageList, currentImageList)) {
      updatePeriod = Math.min(1000, updatePeriod)
      window.backupImageUrlList = Array.from(combinedImageList)
      ImageViewer(combinedImageList, options)
    }

    // wait website update
    await new Promise(resolve => {
      setTimeout(resolve, updatePeriod)
      updateRelease = resolve
      updatePeriod *= multiplier
    })

    // wait visible
    if (document.visibilityState !== 'visible') {
      console.log('Wait document visible')
      while (document.visibilityState !== 'visible') {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
  }
})()
