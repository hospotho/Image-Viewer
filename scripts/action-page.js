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

  let currentImageList = orderedImageUrls
  let timeout
  let period = 200
  const multiplier = 1.2

  const action = async () => {
    clearTimeout(timeout)

    if (!document.documentElement.classList.contains('has-image-viewer')) return

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
          uniqueIframeImage.push(img)
        }
      }
      uniqueImageUrls.push(...uniqueIframeImage)
    }

    const newImageList = await ImageViewerUtils.sortImageDataList(uniqueImageUrls)
    const combinedImageList = ImageViewerUtils.combineImageList(newImageList, currentImageList)

    if (combinedImageList.length > currentImageList.length) {
      currentImageList = combinedImageList
      imageViewer(combinedImageList, options)
    }

    period *= multiplier
    setTimeout(action, period)
  }

  timeout = setTimeout(action, period)

  const observer = new MutationObserver(async () => {
    if (!document.documentElement.classList.contains('has-image-viewer')) {
      observer.disconnect()
      return
    }

    observer.disconnect()

    period = 500
    clearTimeout(timeout)
    timeout = setTimeout(action, period)

    observer.observe(document, {childList: true, subtree: true})
    throttleTimestamp = Date.now()
  })

  observer.observe(document, {childList: true, subtree: true})
})()
