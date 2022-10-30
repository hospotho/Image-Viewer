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
  const [srcUrl, minSize, dom] = nodeInfo === null ? [] : nodeInfo

  if (srcUrl) {
    console.log('Image node found.')
    options.minWidth = Math.min(minSize, options.minWidth)
    options.minHeight = Math.min(minSize, options.minHeight)
  }

  await ImageViewerUtils.simpleUnlazyImage()

  const uniqueImageUrls = ImageViewerUtils.getImageList(options)
  if (!!document.querySelector('iframe')) {
    const iframeImage = await chrome.runtime.sendMessage({msg: 'load_frames', minSize: minSize})
    const uniqueIframeImage = [...new Set(iframeImage)]
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
