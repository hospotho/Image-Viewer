;(function () {
  'use strict'

  if (document.documentElement.classList.contains('has-image-viewer-worker')) return

  document.documentElement.classList.add('has-image-viewer-worker')

  function createDataUrl(srcUrl) {
    return new Promise(resolve => {
      const img = new Image()

      img.onload = () => {
        const c = document.createElement('canvas')
        const ctx = c.getContext('2d')
        c.width = img.naturalWidth
        c.height = img.naturalHeight
        ctx.drawImage(img, 0, 0)
        const url = img.src.match('png') ? c.toDataURL() : img.src.match('webp') ? c.toDataURL('image/webp') : c.toDataURL('image/jpeg')
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

  const domSearcher = (function () {
    // searchImageFromTree
    function checkZIndex(e1, e2) {
      const e1zIndex = parseInt(window.getComputedStyle(e1).zIndex)
      const e2zIndex = parseInt(window.getComputedStyle(e2).zIndex)

      if (e1zIndex === NaN || e2zIndex === NaN) return 0
      if (e1zIndex > e2zIndex) {
        return -1
      } else if (e1zIndex < e2zIndex) {
        return 1
      }
    }
    function checkPosition(e1, e2) {
      const e1Rect = e1.getBoundingClientRect()
      const e2Rect = e2.getBoundingClientRect()

      const commonParent = e1.offsetParent || e1.parentNode
      const parentPosition = commonParent.getBoundingClientRect()
      const e1ActualPosition = {
        x: e1Rect.x - parentPosition.x,
        y: e1Rect.y - parentPosition.y
      }
      const e2ActualPosition = {
        x: e2Rect.x - parentPosition.x,
        y: e2Rect.y - parentPosition.y
      }

      if (e1ActualPosition.y < e2ActualPosition.y) {
        return -1
      } else if (e1ActualPosition.y > e2ActualPosition.y) {
        return 1
      } else if (e1ActualPosition.x < e2ActualPosition.x) {
        return -1
      } else {
        return 1
      }
    }
    function getNodeTreeIndex(node) {
      let index = 0
      let currNode = node.previousSibling
      while (currNode) {
        if (currNode.nodeType !== 3 || !/^\s*$/.test(currNode.data)) {
          index++
        }
        currNode = node.previousSibling
      }
      return index
    }
    function checkTreeIndex(e1, e2) {
      const e1Order = getNodeTreeIndex(e1)
      const e2Order = getNodeTreeIndex(e2)
      if (e1Order > e2Order) {
        return -1
      } else {
        return 1
      }
    }
    function getTopElement(e1, e2) {
      //e1 -1, e2 1, same 0
      if (e1 === e2) return 0

      let result = checkZIndex(e1, e2)
      if (result !== 0) return result

      const e1Position = window.getComputedStyle(e1).position
      const e2Position = window.getComputedStyle(e2).position
      if (e1Position === 'absolute' || e2Position === 'absolute') {
        result = checkPosition(e1, e2)
      } else {
        result = checkTreeIndex(e1, e2)
      }
      return result
    }

    function getAllChildElements(node) {
      if (!node) return []

      const result = Array.from(node.children)
      if (node.shadowRoot) {
        result.push(...node.shadowRoot.children)
      }

      const childElements = Array.from(result)
      for (const child of childElements) {
        if (child.children || child.shadowRoot) {
          result.push(...getAllChildElements(child))
        }
      }
      return result
    }

    function searchImageFromTree(root, viewportPos) {
      const [mouseX, mouseY] = [viewportPos[0], viewportPos[1]]
      const relatedDomList = []
      for (const dom of getAllChildElements(root)) {
        const rect = dom.getBoundingClientRect()
        const inside = rect.left <= mouseX && rect.right >= mouseX && rect.top <= mouseY && rect.bottom >= mouseY
        if (inside) relatedDomList.push(dom)
      }

      const imageInfoList = []
      for (const dom of relatedDomList) {
        const imageInfo = extractImageInfoFromNode(dom)
        if (isImageInfoValid(imageInfo)) {
          imageInfoList.push(imageInfo)
        }
      }
      if (imageInfoList.length === 0) return null

      imageInfoList.sort((a, b) => getTopElement(a[2], b[2]))
      return imageInfoList[0]
    }

    async function searchDomByPosition(viewportPos) {
      const domList = []
      const ptEvent = []
      const infoList = []

      let firstVisibleDom

      while (domList.length < 20) {
        const dom = document.elementFromPoint(viewportPos[0], viewportPos[1])
        if (dom === document.documentElement || dom === domList[domList.length - 1]) break

        if (dom.offsetParent !== null || dom.style.position === 'fixed') {
          firstVisibleDom = firstVisibleDom || dom
        }

        const imageInfo = extractImageInfoFromNode(dom)
        if (isImageInfoValid(imageInfo)) {
          infoList.push(imageInfo)
        }

        domList.push(dom)
        ptEvent.push(dom.style.pointerEvents)
        dom.style.pointerEvents = 'none'
      }

      while (domList.length) {
        const lastDom = domList.pop()
        lastDom.style.pointerEvents = ptEvent.pop()
      }

      if (infoList.length) {
        if (infoList.length === 1) {
          markingDom(infoList[0][2])
          return infoList[0]
        }

        let maxSize = 0
        for (const info of infoList) {
          maxSize = info[1] > maxSize ? info[1] : maxSize
        }
        const largest = infoList.filter(info => info[1] === maxSize)
        if (largest.length === 1) {
          markingDom(largest[0][2])
          return largest[0]
        }

        const sizeList = []
        for (const item of largest) {
          sizeList.push([item, await getImageBitSize(item[0])])
        }
        sizeList.sort((a, b) => b[1] - a[1])
        markingDom(sizeList[0][0][2])
        return sizeList[0][0]
      }

      const imageInfoFromTree = searchImageFromTree(firstVisibleDom, viewportPos)
      if (isImageInfoValid(imageInfoFromTree)) {
        markingDom(imageInfoFromTree[2])
        return imageInfoFromTree
      }

      markingDom()
      return null
    }

    // utility
    function disablePtEvents() {
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
    }
    function restorePtEvents() {
      for (const dom of document.querySelectorAll('.noneToAuto')) {
        dom.style.pointerEvents = 'none'
        dom.classList.remove('noneToAuto')
      }
      for (const dom of document.querySelectorAll('.nullToAuto')) {
        dom.style.pointerEvents = ''
        dom.classList.remove('nullToAuto')
      }
    }

    function extractImageInfoFromNode(dom) {
      if (dom.tagName === 'IMG') {
        const minSize = Math.min(dom.naturalWidth, dom.naturalHeight, dom.clientWidth, dom.clientHeight)
        markingDom(dom)
        return [dom.currentSrc, minSize, dom]
      }

      const minSize = Math.min(dom.clientWidth, dom.clientHeight)
      if (dom.tagName === 'VIDEO' && dom.hasAttribute('poster')) {
        markingDom(dom)
        return [dom.poster, minSize, dom]
      }

      const bg = window.getComputedStyle(dom).backgroundImage
      if (bg?.indexOf('url') === 0 && bg.indexOf('.svg') === -1) {
        const bgUrl = bg.substring(4, bg.length - 1).replace(/['"]/g, '')
        markingDom(dom)
        return [bgUrl, minSize, dom]
      }

      return null
    }

    const isImageInfoValid = imageInfo => imageInfo !== null && imageInfo[0] !== '' && imageInfo[0] !== 'about:blank'
    const getImageBitSize = async src => {
      if (!src || src.startsWith('data')) return 0
      let result
      try {
        const res = await fetch(src, {method: 'HEAD'})
        if (!res.ok) result = 0
        const size = res.headers.get('Content-Length')
        result = typeof size === 'string' ? parseInt(size) : 0
      } catch (error) {
        result = 0
      }
      return result || chrome.runtime.sendMessage({msg: 'get_size', url: src})
    }
    const markingDom = (function () {
      return window.top === window.self
        ? dom => {
            document.querySelector('.ImageViewerLastDom')?.classList.remove('ImageViewerLastDom')
            dom?.classList.add('ImageViewerLastDom')
          }
        : (function () {
            let executed = false
            return () => {
              if (!executed) {
                executed = true
                chrome.runtime.sendMessage('reset_dom')
              }
            }
          })()
    })()

    return {
      searchDomByPosition: function (viewportPos) {
        disablePtEvents()
        const result = searchDomByPosition(viewportPos)
        restorePtEvents()
        return result
      }
    }
  })()

  document.addEventListener(
    'contextmenu',
    async e => {
      const viewportPosition = [e.clientX, e.clientY]
      const imageNodeInfo = await domSearcher.searchDomByPosition(viewportPosition)
      if (!imageNodeInfo) return

      console.log(imageNodeInfo.pop())
      if (window.top !== window.self) {
        imageNodeInfo[0] = await createDataUrl(imageNodeInfo[0])
      }
      // dataURL may image maybe smaller
      imageNodeInfo[1] -= 10
      chrome.runtime.sendMessage({msg: 'update_info', data: imageNodeInfo})
    },
    true
  )
})()
