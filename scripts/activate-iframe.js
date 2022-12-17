;(function () {
  'use strict'

  if (window.top === window.self) return

  function extractImageInfoFromNode(dom) {
    const minSize = Math.min(dom.clientWidth, dom.clientHeight)

    if (dom.tagName === 'IMG') return [dom.currentSrc, minSize, dom]
    if (dom.tagName === 'VIDEO' && dom.hasAttribute('poster')) return [dom.poster, minSize, dom]

    const bg = window.getComputedStyle(dom).backgroundImage
    if (bg?.indexOf('url') === 0 && bg.indexOf('.svg') === -1) {
      const bgUrl = bg.substring(4, bg.length - 1).replace(/['"]/g, '')
      return [bgUrl, minSize, dom]
    }

    return null
  }
  function searchDomByPosition(viewportPos) {
    for (const dom of document.querySelectorAll('*')) {
      if (dom.style.pointerEvents === 'none') {
        dom.style.pointerEvents = 'auto'
        dom.classList.add('noneToAuto')
      }
      const style = window.getComputedStyle(dom)
      if (style.pointerEvents === 'none') {
        dom.style.pointerEvents = 'auto'
        dom.classList.add('nullToAuto')
      }
    }

    const domList = []
    const ptEvent = []

    let dom = document.elementFromPoint(viewportPos[0], viewportPos[1])
    let imageInfo = extractImageInfoFromNode(dom)
    if (imageInfo !== null && imageInfo[0] !== '' && imageInfo[0] !== 'about:blank') return imageInfo

    let baseSize = Math.min(dom.clientWidth, dom.clientHeight)
    domList.push(dom)
    ptEvent.push(dom.style.pointerEvents)
    dom.style.pointerEvents = 'none'
    while (true) {
      dom = document.elementFromPoint(viewportPos[0], viewportPos[1])
      let currSize = Math.min(dom.clientWidth, dom.clientHeight)
      if (dom === document.documentElement || currSize > baseSize * 1.5) break

      imageInfo = extractImageInfoFromNode(dom)
      if (imageInfo !== null && imageInfo[0] !== '' && imageInfo[0] !== 'about:blank') break

      baseSize = currSize
      domList.push(dom)
      ptEvent.push(dom.style.pointerEvents)
      dom.style.pointerEvents = 'none'
    }

    while (domList.length) {
      const dom = domList.pop()
      dom.style.pointerEvents = ptEvent.pop()
    }
    for (const dom of document.querySelectorAll('.noneToAuto')) {
      dom.style.pointerEvents = 'none'
      dom.classList.remove('noneToAuto')
    }
    for (const dom of document.querySelectorAll('.nullToAuto')) {
      dom.style.pointerEvents = ''
      dom.classList.remove('nullToAuto')
    }

    return imageInfo
  }
  function createDataUrl(srcUrl) {
    return new Promise(resolve => {
      const img = new Image()

      img.onload = () => {
        const c = document.createElement('canvas')
        const ctx = c.getContext('2d')
        c.width = img.naturalWidth
        c.height = img.naturalHeight
        ctx.drawImage(img, 0, 0)
        const url = img.src.match('png') ? c.toDataURL() : c.toDataURL('image/jpeg')
        resolve(url)
      }
      img.onerror = () => {
        console.log(new URL(srcUrl).hostname + ' block your access outside iframe')
        resolve('')
      }

      img.crossOrigin = 'anonymous'
      img.src = srcUrl
    })
  }

  document.addEventListener(
    'contextmenu',
    async e => {
      const viewportPosition = [e.clientX, e.clientY]
      const imageNodeInfo = searchDomByPosition(viewportPosition)
      imageNodeInfo[0] = await createDataUrl(imageNodeInfo[0])
      // size of image maybe reduced in data URL form
      imageNodeInfo[1] -= 3
      chrome.runtime.sendMessage({msg: 'update_info', data: imageNodeInfo})
    },
    true
  )
})()
