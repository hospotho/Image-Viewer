;(async function () {
  'use strict'

  if (typeof ImageViewerUtils !== 'object') {
    await chrome.runtime.sendMessage('load_utility')
  }

  const options = window.ImageViewerOption
  options.closeButton = true
  options.cors = !!document.querySelectorAll('img[crossorigin="anonymous"]').length

  const srcUrl = window.ImageViewerTargetUrl
  const type = [...document.getElementsByTagName('img')].filter(img => img.currentSrc === srcUrl)[0]
  if (type) {
    const minSize = Math.min(type.clientWidth, type.clientHeight, type.naturalWidth, type.naturalHeight)
    options.minWidth = Math.min(minSize, options.minWidth)
    options.minHeight = Math.min(minSize, options.minHeight)
  } else {
    options.sizeCheck = true
    console.log(`Image node of ${srcUrl} not found`)
  }

  await ImageViewerUtils.simpleUnlazyImage()

  const uniqueImageUrls = ImageViewerUtils.getImageList(options)
  if (uniqueImageUrls.indexOf(type?.currentSrc) !== -1) {
    options.index = uniqueImageUrls.indexOf(type.currentSrc)
  } else if (uniqueImageUrls.indexOf(srcUrl) !== -1) {
    options.index = uniqueImageUrls.indexOf(srcUrl)
  } else {
    uniqueImageUrls.unshift(srcUrl)
    console.log('Image unshift to list')
  }

  console.log(`${uniqueImageUrls.length} images pass filter or not complete`)

  if (typeof imageViewer !== 'function') {
    await chrome.runtime.sendMessage('load_script')
  }
  imageViewer(uniqueImageUrls, options)
})()
