;(async function () {
  'use strict'

  if (typeof ImageViewerUtils !== 'object') {
    await chrome.runtime.sendMessage('load_utility')
  }

  if (document.documentElement.classList.contains('has-image-viewer')) return

  // init
  const options = window.ImageViewerOption
  options.closeButton = true
  options.referrerPolicy = !!document.querySelector('img[referrerPolicy="no-referrer"]')
  options.cors = !!document.querySelector('img[crossorigin="anonymous"]')
  window.backupImageUrlList ??= []

  // update image size filter
  const nodeInfo = await chrome.runtime.sendMessage('get_info')
  const [srcUrl, nodeSize] = nodeInfo === null ? [] : nodeInfo
  if (nodeSize > 0) {
    options.minWidth = Math.min(nodeSize, options.minWidth)
    options.minHeight = Math.min(nodeSize, options.minHeight)
  }

  const dom = document.querySelector('.ImageViewerLastDom')
  const domRect = dom?.getBoundingClientRect()
  const domSize = domRect ? [domRect.width, domRect.height] : [0, 0]
  if (dom?.tagName === 'IMG') {
    ImageViewerUtils.updateWrapperSize(dom, domSize, options)
  } else {
    options.sizeCheck = true
  }

  const orderedImageUrls = await ImageViewerUtils.getOrderedImageUrls(options)
  const combinedImageList = ImageViewerUtils.combineImageList(orderedImageUrls, window.backupImageUrlList)
  const expired = orderedImageUrls.length + window.backupImageUrlList.length === combinedImageList.length
  window.backupImageUrlList = expired ? orderedImageUrls : combinedImageList

  // find image index
  options.index = ImageViewerUtils.searchImageInfoIndex(dom || srcUrl, window.backupImageUrlList)
  if (options.index === -1) {
    options.index = 0
    window.backupImageUrlList.unshift(srcUrl)
    console.log('Unshift image to list')
  }

  if (typeof imageViewer !== 'function') {
    await chrome.runtime.sendMessage('load_script')
  }
  imageViewer(window.backupImageUrlList, options)

  // auto update
  const period = 500
  let releaser
  const action = async () => {
    while (document.documentElement.classList.contains('has-image-viewer')) {
      if (dom?.tagName === 'IMG') {
        ImageViewerUtils.updateWrapperSize(dom, domSize, options)
      }
      const orderedImageUrls = await ImageViewerUtils.getOrderedImageUrls(options)
      const combinedImageList = ImageViewerUtils.combineImageList(orderedImageUrls, window.backupImageUrlList)

      if (!document.documentElement.classList.contains('has-image-viewer')) return
      if (combinedImageList.length > window.backupImageUrlList.length) {
        window.backupImageUrlList = combinedImageList
        imageViewer(combinedImageList, options)
      }
      await new Promise(resolve => {
        setTimeout(resolve, period)
        releaser = resolve
      })
    }
  }
  const observer = new MutationObserver(() => {
    if (!document.documentElement.classList.contains('has-image-viewer')) {
      observer.disconnect()
      return
    }
    if (typeof release === 'function') release()
  })
  observer.observe(document.documentElement, {childList: true, subtree: true})
  action()

  // auto scroll
  ImageViewerUtils.checkAndStartAutoScroll(options)
})()
