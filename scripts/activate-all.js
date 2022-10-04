;(async function () {
  'use strict'

  if (typeof ImageViewerUtils !== 'object') {
    await chrome.runtime.sendMessage('load_utility')
  }

  const options = window.ImageViewerOption
  options.closeButton = true
  options.minWidth = 0
  options.minHeight = 0
  options.cors = !!document.querySelector('img[crossorigin="anonymous"]')

  if (document.documentElement.classList.contains('has-image-viewer')) {
    ImageViewerUtils.closeImageViewer()
    return
  }

  await ImageViewerUtils.simpleUnlazyImage()

  const uniqueImageUrls = ImageViewerUtils.getAllImage(options)
  if (!!document.querySelector('iframe')) {
    const iframeImage = await chrome.runtime.sendMessage({msg: 'load_frames', filter: false})
    console.log(`loaded ${iframeImage.length} iframe images`)
    uniqueImageUrls.push(...iframeImage)
  }

  console.log(`${uniqueImageUrls.length} images found`)
  if (uniqueImageUrls.length === 0) return

  if (typeof imageViewer !== 'function') {
    await chrome.runtime.sendMessage('load_script')
  }
  imageViewer(uniqueImageUrls, options)
})()
