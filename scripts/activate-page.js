;(async function () {
  'use strict'

  if (typeof ImageViewerUtils !== 'object') {
    await chrome.runtime.sendMessage('load_utility')
  }

  const options = window.ImageViewerOption
  options.closeButton = true
  options.cors = document.querySelectorAll('img[crossorigin="anonymous"]').length ? true : false

  if (document.documentElement.classList.contains('has-image-viewer')) {
    ImageViewerUtils.closeImageViewer()
    return
  }

  await ImageViewerUtils.simpleUnlazyImage()

  const uniqueImageUrls = ImageViewerUtils.getImageList(options)
  if (!!document.querySelector('iframe')) {
    const iframeImage = await chrome.runtime.sendMessage('load_frames')
    uniqueImageUrls.push(...iframeImage)
  }
  
  console.log(`${uniqueImageUrls.length} images pass filter or not complete`)
  if (uniqueImageUrls.length === 0) return

  if (typeof imageViewer !== 'function') {
    await chrome.runtime.sendMessage('load_script')
  }
  imageViewer(uniqueImageUrls, options)
})()
