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
  if (anchorList.length === 0) return

  // collect image data
  let complete = false
  let terminated = false
  const imageDataList = []

  // process anchors with size
  let left = 0
  let right = anchorList.length - 1
  while (true) {
    const mid = Math.floor((left + right) / 2)
    const width = anchorList[mid].getAttribute('iv-width')
    width ? (left = mid + 1) : (right = mid - 1)
    if (left > right) break
  }
  if (right !== -1) {
    const skipList = anchorList.splice(0, right + 1)
    for (const anchor of skipList) {
      const width = Number(anchor.getAttribute('iv-width'))
      const height = Number(anchor.getAttribute('iv-height'))
      if (width >= options.minWidth && height >= options.minHeight) imageDataList.push({src: anchor.href, dom: anchor})
    }
  }

  // process remaining anchors
  const action = async anchor => {
    const width = anchor.getAttribute('iv-width')
    const height = anchor.getAttribute('iv-height')
    if (width) return [Number(width), Number(height)]
    const size = await safeSendMessage({msg: 'get_real_size', url: anchor.href})
    anchor.setAttribute('iv-width', size[0])
    anchor.setAttribute('iv-height', size[1])
    return size
  }
  const startAsyncLoop = async () => {
    while (anchorList.length) {
      if (terminated) return
      const asyncList = anchorList.splice(0, 8).map(anchor => action(anchor).then(size => [size, anchor]))
      for await (const [size, anchor] of asyncList) {
        if (size[0] >= options.minWidth && size[1] >= options.minHeight) imageDataList.push({src: anchor.href, dom: anchor})
      }
    }
    setTimeout(() => (complete = true), 3000)
  }
  startAsyncLoop()

  // wait for image data
  const overtime = setTimeout(() => alert('Images still loading'), 3000)
  while (true) {
    await new Promise(resolve => setTimeout(resolve, 100))
    if (complete || imageDataList.length) break
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
