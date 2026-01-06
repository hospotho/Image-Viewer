;(async function () {
  'use strict'

  const safeSendMessage = function (...args) {
    if (chrome.runtime?.id) {
      return chrome.runtime.sendMessage(...args)
    }
  }

  if (typeof ImageViewerUtils !== 'object') {
    await safeSendMessage('load_utility')
  }

  if (document.body.classList.contains('iv-attached')) {
    ImageViewer('close_image_viewer')
    return
  }

  // init
  const options = window.ImageViewerOption
  options.closeButton = true

  // natural sort
  const collator = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'})
  const anchorList = [...document.getElementsByTagName('a')].filter(a => !a.href.endsWith('/')).sort(collator.compare)
  const sizeList = await Promise.all(anchorList.map(a => ImageViewerUtils.getImageRealSize(a.href)))

  const imageDataList = []
  const minSize = Math.min(options.minWidth, options.minHeight)
  for (let i = 0; i < anchorList.length; i++) {
    if (sizeList[i] >= minSize) imageDataList.push({src: anchorList[i].href, dom: anchorList[i]})
  }

  // build image viewer
  ImageViewer(imageDataList, options)
})()
