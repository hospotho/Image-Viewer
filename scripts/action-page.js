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
  window.backupImageUrlList ??= []

  const orderedImageUrls = await ImageViewerUtils.getOrderedImageUrls(options)
  const combinedImageList = ImageViewerUtils.combineImageList(orderedImageUrls, window.backupImageUrlList)
  window.backupImageUrlList = Array.from(combinedImageList)

  if (typeof imageViewer !== 'function') {
    await chrome.runtime.sendMessage('load_script')
  }
  imageViewer(window.backupImageUrlList, options)

  // auto update
  let period = 500
  const multiplier = 1.2
  let updateRelease = null
  const action = async () => {
    while (document.documentElement.classList.contains('has-image-viewer')) {
      const orderedImageUrls = await ImageViewerUtils.getOrderedImageUrls(options)
      const combinedImageList = ImageViewerUtils.combineImageList(orderedImageUrls, window.backupImageUrlList)
      const currentImageList = imageViewer('get_image_list')

      if (!document.documentElement.classList.contains('has-image-viewer')) return
      if (combinedImageList.length > currentImageList.length || !ImageViewerUtils.isStrLengthEqual(combinedImageList, currentImageList)) {
        window.backupImageUrlList = Array.from(combinedImageList)
        imageViewer(combinedImageList, options)
      }
      await new Promise(_resolve => {
        const resolve = async () => {
          clearTimeout(timeout)
          if (document.visibilityState !== 'visible') {
            console.log('wait document visible')
            while (document.visibilityState !== 'visible') {
              await new Promise(resolve => setTimeout(resolve, 100))
            }
          }
          _resolve()
        }
        const timeout = setTimeout(() => {
          period *= multiplier
          resolve()
        }, period)
        updateRelease = resolve
      })
    }
  }

  const observer = new MutationObserver(async () => {
    let currentScrollX = window.scrollX
    let currentScrollY = window.scrollY
    if (!document.documentElement.classList.contains('has-image-viewer')) {
      observer.disconnect()
      return
    }
    if (typeof updateRelease === 'function') {
      observer.disconnect()
      await new Promise(resolve => setTimeout(resolve, 50))
      while (currentScrollX !== window.scrollX || currentScrollY !== window.scrollY) {
        currentScrollX = window.scrollX
        currentScrollY = window.scrollY
        await new Promise(resolve => setTimeout(resolve, 300))
      }
      observer.observe(document.documentElement, {childList: true, subtree: true})
      period = 500
      updateRelease()
    }
  })
  observer.observe(document.documentElement, {childList: true, subtree: true})
  action()
})()
