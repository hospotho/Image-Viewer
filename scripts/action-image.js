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

  if (document.documentElement.classList.contains('has-image-viewer')) return

  // init
  const options = window.ImageViewerOption
  options.closeButton = true
  options.referrerPolicy = !!document.querySelector('img[referrerPolicy="no-referrer"]')
  options.cors = !!document.querySelector('img[crossorigin="anonymous"]')
  window.backupImageUrlList ??= []

  // update image size filter
  const nodeInfo = (await safeSendMessage('get_info')) || []
  const [srcUrl, nodeSize] = nodeInfo
  if (nodeSize) {
    options.minWidth = Math.min(nodeSize, options.minWidth)
    options.minHeight = Math.min(nodeSize, options.minHeight)
  }

  const dom = document.querySelector('.ImageViewerLastDom')
  const domRect = dom?.getBoundingClientRect()
  const domSize = domRect ? [domRect.width, domRect.height] : [0, 0]
  ImageViewerUtils.updateWrapperSize(dom, domSize, options)

  const orderedImageUrls = await ImageViewerUtils.getOrderedImageUrls(options)
  const combinedImageList = ImageViewerUtils.combineImageList(orderedImageUrls, window.backupImageUrlList)
  window.backupImageUrlList = Array.from(combinedImageList)

  // find image index
  options.index = ImageViewerUtils.searchImageInfoIndex(dom || srcUrl, window.backupImageUrlList)
  if (options.index === -1) {
    options.index = 0
    window.backupImageUrlList.unshift(srcUrl)
    console.log('Unshift image to list')
  }

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
      await new Promise(resolve => setTimeout(resolve, 200))
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
    if (dom?.tagName === 'IMG') {
      ImageViewerUtils.updateWrapperSize(dom, domSize, options)
    }
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
    while (document.visibilityState !== 'visible') {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
})()
