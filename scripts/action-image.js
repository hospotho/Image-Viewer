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

  if (nodeSize > 0) {
    options.minWidth = Math.min(nodeSize, options.minWidth)
    options.minHeight = Math.min(nodeSize, options.minHeight)
  }

  if (dom) {
    const [divWidth, divHeight] = ImageViewerUtils.getWrapperSize(dom) || []
    if (divWidth) {
      options.minWidth = Math.min(divWidth, options.minWidth)
      options.minHeight = Math.min(divHeight, options.minHeight)
    }
  }

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

  const orderedImageUrls = await ImageViewerUtils.sortImageDataList(uniqueImageUrls)

  options.index = -1
  if (dom) {
    const currentUrl = ImageViewerUtils.getDomUrl(dom)
    const index = orderedImageUrls.indexOf(currentUrl)
    options.index = index
  } else if (srcUrl) {
    if (!srcUrl.startsWith('data')) {
      const index = orderedImageUrls.indexOf(srcUrl)
      options.index = index
    } else {
      for (let i = 0; i < orderedImageUrls.length; i++) {
        if (orderedImageUrls[i]?.[0] === srcUrl) {
          options.index = i
          break
        }
      }
    }
  }
  if (options.index === -1) {
    options.index = 0
    orderedImageUrls.unshift(srcUrl)
    console.log('Unshift Image to list')
  }

  for (const data of orderedImageUrls) {
    if (data[0].startsWith('data')) {
      data[0] = ImageViewerUtils.dataURLToObjectURL(data[0])
    }
  }

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

    if (dom) {
      const [divWidth, divHeight] = ImageViewerUtils.getWrapperSize(dom) || []
      if (divWidth) {
        options.minWidth = Math.min(divWidth, options.minWidth)
        options.minHeight = Math.min(divHeight, options.minHeight)
      }
    }

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
  })

  observer.observe(document, {childList: true, subtree: true})
})()
