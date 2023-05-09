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

  let currentImageList = await ImageViewerUtils.getOrderedImageUrls(options)
  if (typeof imageViewer !== 'function') {
    await chrome.runtime.sendMessage('load_script')
  }
  imageViewer(currentImageList, options)

  // auto update
  let timeout
  let period = 200
  const multiplier = 1.2
  const action = async () => {
    clearTimeout(timeout)

    if (!document.documentElement.classList.contains('has-image-viewer')) return
    const newImageList = await ImageViewerUtils.getOrderedImageUrls(options)
    const combinedImageList = ImageViewerUtils.combineImageList(newImageList, currentImageList)

    if (!document.documentElement.classList.contains('has-image-viewer')) return
    if (combinedImageList.length > currentImageList.length) {
      currentImageList = combinedImageList
      imageViewer(combinedImageList, options)
    }
    period *= multiplier
    setTimeout(action, period)
  }

  timeout = setTimeout(action, period)
  const observer = new MutationObserver(() => {
    observer.disconnect()
    clearTimeout(timeout)
    if (!document.documentElement.classList.contains('has-image-viewer')) return

    period = 500
    timeout = setTimeout(action, period)
    observer.observe(document.documentElement, {childList: true, subtree: true})
  })
  observer.observe(document.documentElement, {childList: true, subtree: true})

  // auto scroll
  ImageViewerUtils.checkAndStartAutoScroll(options)
})()
