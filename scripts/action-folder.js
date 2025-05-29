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

  const anchorList = [...document.getElementsByTagName('a')].filter(a => !a.href.endsWith('/'))
  const isImageList = await safeSendMessage({msg: 'is_file_image', urlList: anchorList.map(a => a.href)})
  const sizeList = await Promise.all(anchorList.map((a, i) => isImageList[i] && ImageViewerUtils.getImageRealSize(a.href)))

  const imageDataList = []
  const minSize = Math.min(options.minWidth, options.minHeight)
  for (let i = 0; i < anchorList.length; i++) {
    if (sizeList[i] >= minSize) imageDataList.push({src: anchorList[i].href, dom: anchorList[i]})
  }

  // build image viewer
  ImageViewer(imageDataList, options)
})()
