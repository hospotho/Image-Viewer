;(async function () {
  'use strict'

  if (typeof ImageViewerUtils !== 'object') {
    await chrome.runtime.sendMessage('load_utility')
  }

  if (document.documentElement.classList.contains('has-image-viewer')) {
    ImageViewerUtils.closeImageViewer()
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
  window.backupImageUrlList = combinedImageList

  if (typeof imageViewer !== 'function') {
    await chrome.runtime.sendMessage('load_script')
  }
  imageViewer(window.backupImageUrlList, options)

  // auto update
  let period = 500
  const multiplier = 1.2
  let release
  const action = async () => {
    while (document.documentElement.classList.contains('has-image-viewer')) {
      const orderedImageUrls = await ImageViewerUtils.getOrderedImageUrls(options)
      const combinedImageList = ImageViewerUtils.combineImageList(orderedImageUrls, window.backupImageUrlList)

      if (!document.documentElement.classList.contains('has-image-viewer')) return
      if (combinedImageList.length > window.backupImageUrlList.length) {
        window.backupImageUrlList = combinedImageList
        imageViewer(combinedImageList, options)
      }
      await new Promise(_resolve => {
        const resolve = () => {
          clearTimeout(timeout)
          _resolve()
        }
        const timeout = setTimeout(() => {
          period *= multiplier
          resolve()
        }, period)
        release = resolve
      })
    }
  }
  const observer = new MutationObserver(() => {
    if (!document.documentElement.classList.contains('has-image-viewer')) {
      observer.disconnect()
      return
    }
    if (typeof release === 'function') {
      period = 500
      release()
    }
  })
  observer.observe(document.documentElement, {childList: true, subtree: true})
  action()

  // auto scroll
  ImageViewerUtils.checkAndStartAutoScroll(options)
})()
