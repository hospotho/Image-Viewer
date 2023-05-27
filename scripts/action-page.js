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

  let currentImageList = await ImageViewerUtils.getOrderedImageUrls(options)
  if (typeof imageViewer !== 'function') {
    await chrome.runtime.sendMessage('load_script')
  }
  imageViewer(currentImageList, options)

  // auto update
  let period = 200
  const multiplier = 1.2
  const action = async () => {
    while (document.documentElement.classList.contains('has-image-viewer')) {
      const newImageList = await ImageViewerUtils.getOrderedImageUrls(options)
      const combinedImageList = ImageViewerUtils.combineImageList(newImageList, currentImageList)

      if (!document.documentElement.classList.contains('has-image-viewer')) return
      if (combinedImageList.length > currentImageList.length) {
        currentImageList = combinedImageList
        imageViewer(combinedImageList, options)
      }
      period *= multiplier
      await new Promise(resolve => setTimeout(resolve, period))
    }
  }

  setTimeout(action, period)
  const observer = new MutationObserver(() => {
    if (!document.documentElement.classList.contains('has-image-viewer')) {
      observer.disconnect()
      return
    }
    period = 200
  })
  observer.observe(document.documentElement, {childList: true, subtree: true})

  // auto scroll
  ImageViewerUtils.checkAndStartAutoScroll(options)
})()
