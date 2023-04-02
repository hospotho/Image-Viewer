;(async function () {
  'use strict'

  if (typeof ImageViewerUtils !== 'object') {
    await chrome.runtime.sendMessage('load_utility')
  }

  if (document.documentElement.classList.contains('has-image-viewer')) {
    ImageViewerUtils.closeImageViewer()
    return
  }

  const options = window.ImageViewerOption
  options.closeButton = true
  options.referrerPolicy = !!document.querySelector('img[referrerPolicy="no-referrer"]')
  options.cors = !!document.querySelector('img[crossorigin="anonymous"]')

  await ImageViewerUtils.simpleUnlazyImage()

  const uniqueImageUrls = ImageViewerUtils.getImageList(options)

  if (!!document.querySelector('iframe')) {
    const minSize = Math.min(options.minWidth, options.minHeight)
    const iframeImage = await chrome.runtime.sendMessage({msg: 'extract_frames', minSize: minSize})

    const uniqueIframeImage = []
    const uniqueIframeImageUrls = new Set()
    for (const img of iframeImage) {
      if (!uniqueIframeImageUrls.has(img[0])) {
        uniqueIframeImageUrls.add(img[0])
        uniqueIframeImage.push([ImageViewerUtils.dataURLToObjectURL(img[0]), img[1]])
      }
    }
    uniqueImageUrls.push(...uniqueIframeImage)
  }

  if (uniqueImageUrls.length === 0) return

  const orderedImageUrls = await ImageViewerUtils.sortImageDataList(uniqueImageUrls)

  if (typeof imageViewer !== 'function') {
    await chrome.runtime.sendMessage('load_script')
  }
  imageViewer(orderedImageUrls, options)
})()
