;(async function () {
  'use strict'

  if (typeof ImageViewerUtils !== 'object') {
    await chrome.runtime.sendMessage('load_utility')
  }

  if (document.documentElement.classList.contains('has-image-viewer')) return

  const options = window.ImageViewerOption
  options.closeButton = true
  options.referrerPolicy = !!document.querySelector('img[referrerPolicy="no-referrer"]')
  options.cors = !!document.querySelector('img[crossorigin="anonymous"]')

  const nodeInfo = await chrome.runtime.sendMessage('get_info')
  const [srcUrl, nodeSize] = nodeInfo === null ? [] : nodeInfo
  const dom = document.querySelector('.ImageViewerLastDom')
  const domSize = Math.min(dom?.clientWidth, dom?.clientHeight) || 0
  if (nodeSize > 0) {
    options.minWidth = Math.min(nodeSize, options.minWidth)
    options.minHeight = Math.min(nodeSize, options.minHeight)
  }
  if (dom?.tagName === 'IMG') {
    ImageViewerUtils.updateWrapperSize(dom, domSize, options)
  } else {
    options.sizeCheck = true
  }

  const orderedImageUrls = await ImageViewerUtils.getOrderedImageUrls(options)

  options.index = ImageViewerUtils.searchImageInfoIndex(dom || srcUrl, orderedImageUrls)
  if (options.index === -1) {
    options.index = 0
    orderedImageUrls.unshift(srcUrl)
    console.log('Unshift image to list')
  }

  currentImageList = orderedImageUrls

  if (typeof imageViewer !== 'function') {
    await chrome.runtime.sendMessage('load_script')
  }
  imageViewer(currentImageList, options)

  const action = async () => {
    clearTimeout(timeout)

    if (!document.documentElement.classList.contains('has-image-viewer')) return

    ImageViewerUtils.updateWrapperSize(dom, domSize, options)
    const newImageList = await ImageViewerUtils.getOrderedImageUrls(options)
    const combinedImageList = ImageViewerUtils.combineImageList(newImageList, currentImageList)

    if (combinedImageList.length > currentImageList.length) {
      currentImageList = combinedImageList
      imageViewer(combinedImageList, options)
    }

    period *= multiplier
    setTimeout(action, period)
  }

  timeout = setTimeout(action, period)

  const observer = new MutationObserver(() => {
    observer.disconnect()
    if (!document.documentElement.classList.contains('has-image-viewer')) return

    period = 500
    clearTimeout(timeout)
    timeout = setTimeout(action, period)

    observer.observe(document, {childList: true, subtree: true})
  })

  observer.observe(document, {childList: true, subtree: true})
})()
