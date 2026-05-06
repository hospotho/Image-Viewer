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
  const minSize = Math.min(options.minWidth, options.minHeight)
  options.closeButton = true

  // natural sort
  const collator = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'})
  const anchorList = [...document.getElementsByTagName('a')].filter(a => !a.href.endsWith('/')).sort(collator.compare)

  // load size in background
  const asyncList = anchorList.map(a => a.getAttribute('iv-size') || ImageViewerUtils.getImageRealSize(a.href).then(size => a.setAttribute('iv-size', size)))

  let ready = false
  while (!ready) {
    // collect image data
    const imageDataList = []
    for (const anchor of anchorList) {
      const size = anchor.getAttribute('iv-size')
      if (size && Number(size) >= minSize) imageDataList.push({src: anchor.href, dom: anchor})
    }
    // update image viewer
    ImageViewer(imageDataList, options)
    await new Promise(resolve => setTimeout(resolve, 100))

    // check finish
    const complete = await Promise.race([Promise.all(asyncList), new Promise(resolve => setTimeout(resolve, 0, false))])
    if (complete) setTimeout(() => (ready = true), 100)
  }
})()
