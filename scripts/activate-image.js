;(async function () {
  'use strict'

  if (typeof ImageViewerUtils !== 'object') {
    await chrome.runtime.sendMessage('load_utility')
  }

  var {options} = await chrome.runtime.sendMessage('get_options')
  options.closeButton = true

  const [srcUrl] = await chrome.runtime.sendMessage('get_args')
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

  var uniqueImageUrls = ImageViewerUtils.getImageList(options)
  if (uniqueImageUrls.indexOf(type?.currentSrc) !== -1) {
    options.index = uniqueImageUrls.indexOf(type.currentSrc)
  } else if (uniqueImageUrls.indexOf(srcUrl) !== -1) {
    options.index = uniqueImageUrls.indexOf(srcUrl)
  } else {
    uniqueImageUrls.unshift(srcUrl)
    console.log('Image unshift to list')
  }

  console.log(`${uniqueImageUrls.length} images pass filter`)

  if (typeof imageViewer !== 'function') {
    await chrome.runtime.sendMessage('load_script')
  }
  imageViewer(uniqueImageUrls, options)
})()
