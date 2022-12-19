;(async function () {
  'use strict'

  const image = document.querySelector(`body img[src='${location.href}']`)
  if (!image) {
    console.log('Init content script.')

    function extractImageInfoFromNode(dom) {
      if (dom.tagName === 'IMG') {
        const minSize = Math.min(dom.naturalWidth, dom.naturalHeight, dom.clientWidth, dom.clientHeight)
        return [dom.currentSrc, minSize, dom]
      }

      if (dom.tagName === 'VIDEO' && dom.hasAttribute('poster')) {
        const minSize = Math.min(dom.clientWidth, dom.clientHeight)
        return [dom.poster, minSize, dom]
      }

      const bg = window.getComputedStyle(dom).backgroundImage
      if (bg?.indexOf('url') === 0 && bg.indexOf('.svg') === -1) {
        const bgUrl = bg.substring(4, bg.length - 1).replace(/['"]/g, '')
        return [bgUrl, minSize, dom]
      }

      return null
    }
    function searchDomByPosition(viewportPos) {
      const domList = []
      const ptEvent = []

      let dom = document.elementFromPoint(viewportPos[0], viewportPos[1])
      let imageInfo = extractImageInfoFromNode(dom)
      if (imageInfo !== null && imageInfo[0] !== '' && imageInfo[0] !== 'about:blank') {
        console.log(dom)
        return imageInfo
      }

      let baseSize = Math.min(dom.clientWidth, dom.clientHeight)
      domList.push(dom)
      ptEvent.push(dom.style.pointerEvents)
      dom.style.pointerEvents = 'none'
      while (true) {
        dom = document.elementFromPoint(viewportPos[0], viewportPos[1])
        let currSize = Math.min(dom.clientWidth, dom.clientHeight)
        if (dom === document.documentElement || dom === domList[domList.length - 1] || currSize > baseSize * 1.5) break

        imageInfo = extractImageInfoFromNode(dom)
        if (imageInfo !== null && imageInfo[0] !== '' && imageInfo[0] !== 'about:blank') {
          console.log(dom)
          break
        }

        baseSize = currSize
        domList.push(dom)
        ptEvent.push(dom.style.pointerEvents)
        dom.style.pointerEvents = 'none'
      }

      while (domList.length) {
        const dom = domList.pop()
        dom.style.pointerEvents = ptEvent.pop()
      }

      return imageInfo
    }

    document.addEventListener(
      'contextmenu',
      e => {
        const viewportPosition = [e.clientX, e.clientY]
        const imageNodeInfo = searchDomByPosition(viewportPosition)
        chrome.runtime.sendMessage({msg: 'update_info', data: imageNodeInfo})
      },
      true
    )

    return
  }

  const options = await chrome.runtime.sendMessage('get_options')
  options.closeButton = false
  options.minWidth = 0
  options.minHeight = 0

  await chrome.runtime.sendMessage('load_script')
  image.style.display = 'none'
  imageViewer([image.src], options)
})()
