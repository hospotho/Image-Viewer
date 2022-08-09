;(async function () {
  'use strict'

  if (typeof ImageViewerUtils !== 'object') {
    await chrome.runtime.sendMessage('load_utility')
  }

  var {options} = await chrome.runtime.sendMessage('get_options')
  options.closeButton = true

  if (document.documentElement.classList.contains('has-image-viewer')) {
    ImageViewerUtils.closeImageViewer()
    return
  }

  await ImageViewerUtils.simpleUnlazyImage()

  var uniqueImageUrls = ImageViewerUtils.getImageList(options)
  console.log(`${uniqueImageUrls.length} images pass filter`)
  if (uniqueImageUrls.length === 0) return

  if (typeof imageViewer !== 'function') {
    await chrome.runtime.sendMessage('load_script')
  }
  imageViewer(uniqueImageUrls, options)
})()
