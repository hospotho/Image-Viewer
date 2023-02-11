;(async function () {
  'use strict'

  if (typeof ImageViewerUtils !== 'object') {
    console.log('loading utility')
    await chrome.runtime.sendMessage('load_utility')
  }

  const options = window.ImageViewerOption
  options.closeButton = true
  options.cors = !!document.querySelector('img[crossorigin="anonymous"]')

  const nodeInfo = await chrome.runtime.sendMessage('get_info')
  const [srcUrl, minSize] = nodeInfo === null ? [] : nodeInfo
  const dom = document.querySelector('.ImageViewerLastDom')

  if (srcUrl) {
    console.log('Image node found.')
    options.minWidth = Math.min(minSize, options.minWidth)
    options.minHeight = Math.min(minSize, options.minHeight)
  }

  await ImageViewerUtils.simpleUnlazyImage()

  const uniqueImageUrls = ImageViewerUtils.getImageList(options)
  if (!!document.querySelector('iframe')) {
    const iframeImage = await chrome.runtime.sendMessage({msg: 'load_frames', minSize: minSize})
    // const uniqueIframeImage = [...new Set(iframeImage)]
    const uniqueIframeImage = []
    outer: for (const img of iframeImage) {
      for (const unique of uniqueIframeImage) {
        if (img[0] === unique[0]) continue outer
      }
      uniqueIframeImage.push(img)
    }
    console.log(`loaded ${uniqueIframeImage.length} iframe images`)
    uniqueImageUrls.push(...uniqueIframeImage)
  }

  if (uniqueImageUrls.indexOf(dom?.currentSrc) !== -1) {
    options.index = uniqueImageUrls.indexOf(dom.currentSrc)
  } else if (uniqueImageUrls.indexOf(srcUrl) !== -1) {
    options.index = uniqueImageUrls.indexOf(srcUrl)
  } else if (srcUrl) {
    uniqueImageUrls.unshift(srcUrl)
    console.log('Image unshift to list')
  }

  console.log(`${uniqueImageUrls.length} images pass filter or still loading`)

  if (typeof imageViewer !== 'function') {
    await chrome.runtime.sendMessage('load_script')
  }
  imageViewer(uniqueImageUrls, options)
})()
