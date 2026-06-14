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

  // collect image data
  let complete = false
  let terminated = false
  const imageDataList = []

  let left = 0
  let right = anchorList.length - 1
  while (true) {
    const mid = Math.floor((left + right) / 2)
    const size = anchorList[mid].getAttribute('iv-size')
    size ? (left = mid + 1) : (right = mid - 1)
    if (left > right) break
  }
  if (right !== -1) {
    const skipList = anchorList.splice(0, right + 1)
    for (const anchor of skipList) {
      const size = Number(anchor.getAttribute('iv-size'))
      if (size >= minSize) imageDataList.push({src: anchor.href, dom: anchor})
    }
  }

  ;(async () => {
    const action = async anchor => {
      const attrSize = anchor.getAttribute('iv-size')
      if (attrSize) return Number(attrSize)
      const size = await safeSendMessage({msg: 'get_real_size', url: anchor.href})
      anchor.setAttribute('iv-size', size)
      return size
    }
    while (anchorList.length) {
      if (terminated) return
      const asyncList = anchorList.splice(0, 32).map(anchor => action(anchor).then(size => [size, anchor]))
      for await (const [size, anchor] of asyncList) {
        if (size >= minSize) imageDataList.push({src: anchor.href, dom: anchor})
      }
    }
    setTimeout(() => (complete = true), 1000)
  })()

  // wait for image data
  const overtime = setTimeout(() => alert('Images still loading'), 3000)
  while (true) {
    await new Promise(resolve => setTimeout(resolve, 100))
    if (imageDataList.length) break
    if (anchorList.length === 0) return
  }
  clearTimeout(overtime)

  while (true) {
    // update image viewer
    ImageViewer(imageDataList, options)
    await new Promise(resolve => setTimeout(resolve, 500))
    if (complete || !document.body.classList.contains('iv-attached')) break
  }
  terminated = true
})()
