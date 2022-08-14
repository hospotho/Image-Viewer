;(async function () {
  'use strict'

  if (typeof ImageViewerUtils !== 'object') {
    await chrome.runtime.sendMessage('load_utility')
  }

  let {options} = await chrome.runtime.sendMessage('get_options')
  options.closeButton = true
  options.minWidth = 0
  options.minHeight = 0

  if (document.documentElement.classList.contains('has-image-viewer')) {
    ImageViewerUtils.closeImageViewer()
    return
  }

  await ImageViewerUtils.simpleUnlazyImage()

  const uniqueImageUrls = ImageViewerUtils.getAllImage()
  console.log(`${uniqueImageUrls.length} images found`)
  if (uniqueImageUrls.length === 0) return

  if (typeof imageViewer !== 'function') {
    await chrome.runtime.sendMessage('load_script')
  }
  imageViewer(uniqueImageUrls, options)
})()
