;(async function () {
  'use strict'

  if (typeof ImageViewerUtils !== 'object') {
    await chrome.runtime.sendMessage('load_utility')
  }

  const options = window.ImageViewerOption
  options.closeButton = true
  options.cors = !!document.querySelector('img[crossorigin="anonymous"]')

  if (document.documentElement.classList.contains('has-image-viewer')) {
    ImageViewerUtils.closeImageViewer()
    return
  }

  await ImageViewerUtils.simpleUnlazyImage()

  const uniqueImageUrls = ImageViewerUtils.getImageList(options)
  if (!!document.querySelector('iframe')) {
    const minSize = Math.min(options.minWidth, options.minHeight)
    const iframeImage = await chrome.runtime.sendMessage({msg: 'load_frames', minSize: minSize})
    const uniqueIframeImage = []
    outer: for (const img of iframeImage) {
      for (const unique of uniqueIframeImage) {
        if (img[0] === unique[0]) continue outer
      }
      uniqueIframeImage.push([ImageViewerUtils.dataURLToObjectURL(img[0]), img[1]])
    }
    uniqueImageUrls.push(...uniqueIframeImage)
  }

  if (uniqueImageUrls.length === 0) return

  const orderedImageUrls = ImageViewerUtils.sortImageDataList(uniqueImageUrls)

  if (typeof imageViewer !== 'function') {
    await chrome.runtime.sendMessage('load_script')
  }
  imageViewer(orderedImageUrls, options)
})()
