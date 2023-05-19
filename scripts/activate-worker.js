;(async function () {
  'use strict'

  if (document.documentElement.classList.contains('has-image-viewer-worker')) return

  document.documentElement.classList.add('has-image-viewer-worker')

  const options = await chrome.runtime.sendMessage({msg: 'get_options'})
  const domainList = []
  const regexList = []
  for (const str of options.hoverCheckDisableList) {
    if (str[0] === '/' && str[str.length - 1] === '/') {
      regexList.push(str)
    } else {
      domainList.push(str)
    }
  }
  let disableHoverCheck = domainList.includes(location.hostname.replace('www.', ''))
  disableHoverCheck ||= regexList.map(regex => regex.test(location.href)).filter(Boolean).length

  if (window.top === window.self && !disableHoverCheck) {
    const styles = '.disable-hover, .disable-hover * {pointer-events: none !important;}'
    const styleSheet = document.createElement('style')
    styleSheet.innerText = styles
    document.head.appendChild(styleSheet)
  }

  const domSearcher = (function () {
    // searchImageFromTree
    function checkZIndex(e1, e2) {
      const e1zIndex = parseInt(window.getComputedStyle(e1).zIndex)
      const e2zIndex = parseInt(window.getComputedStyle(e2).zIndex)

      if (Number.isNaN(e1zIndex) || Number.isNaN(e2zIndex)) return 0
      if (e1zIndex > e2zIndex) {
        return -1
      } else if (e1zIndex < e2zIndex) {
        return 1
      } else {
        return 0
      }
    }
    function checkPosition(e1, e2) {
      const e1Rect = e1.getBoundingClientRect()
      const e2Rect = e2.getBoundingClientRect()

      const commonParent = e1.offsetParent || e1.parentNode
      const parentPosition = commonParent.getBoundingClientRect()

      const e1ActualPositionX = e1Rect.x - parentPosition.x
      const e1ActualPositionY = e1Rect.y - parentPosition.y
      const e2ActualPositionX = e2Rect.x - parentPosition.x
      const e2ActualPositionY = e2Rect.y - parentPosition.y

      if (e1ActualPositionY < e2ActualPositionY) {
        return -1
      } else if (e1ActualPositionY > e2ActualPositionY) {
        return 1
      } else if (e1ActualPositionX < e2ActualPositionX) {
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
        currNode = currNode.previousSibling
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
      // e1 -1, e2 1, same 0
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

    function searchImageFromTree(dom, viewportPos) {
      if (!dom) return null

      let root = dom.parentElement
      let prevSibling = root.previousElementSibling
      let nextSibling = root.nextElementSibling

      let rootClassList = root.classList.toString()
      let prevClassList = prevSibling && prevSibling.classList.toString()
      let nextClassList = nextSibling && nextSibling.classList.toString()

      let hasSameKindSibling = false
      hasSameKindSibling ||= prevSibling ? prevClassList === rootClassList || prevSibling.tagName === root.tagName : false
      hasSameKindSibling ||= nextSibling ? nextClassList === rootClassList || nextSibling.tagName === root.tagName : false
      while (!hasSameKindSibling) {
        if (root === document.documentElement) return null
        root = root.parentElement
        prevSibling = root.previousElementSibling
        nextSibling = root.nextElementSibling

        rootClassList = root.classList.toString()
        prevClassList = prevSibling && prevSibling.classList.toString()
        nextClassList = nextSibling && nextSibling.classList.toString()

        hasSameKindSibling ||= prevSibling ? prevClassList === rootClassList || prevSibling.tagName === root.tagName : false
        hasSameKindSibling ||= nextSibling ? nextClassList === rootClassList || nextSibling.tagName === root.tagName : false
      }

      root = root.parentElement
      const [mouseX, mouseY] = viewportPos
      const relatedDomList = []
      for (const dom of getAllChildElements(root)) {
        const hidden = dom.offsetParent === null && dom.style.position !== 'fixed'
        if (hidden) {
          relatedDomList.push(dom)
          continue
        }
        const rect = dom.getBoundingClientRect()
        const inside = rect.left <= mouseX && rect.right >= mouseX && rect.top <= mouseY && rect.bottom >= mouseY
        if (inside) relatedDomList.push(dom)
      }

      const imageInfoList = []
      for (const dom of relatedDomList) {
        const imageInfo = extractImageInfoFromNode(dom)
        if (isImageInfoValid(imageInfo)) imageInfoList.push(imageInfo)
      }
      if (imageInfoList.length === 0) return null

      imageInfoList.sort((a, b) => getTopElement(a[2], b[2]))
      return imageInfoList[0]
    }

    // utility
    function extractImageInfoFromNode(dom) {
      if (dom.tagName === 'IMG') {
        const sizeList = [dom.naturalWidth, dom.naturalHeight, dom.clientWidth, dom.clientHeight]
        const minSize = Math.min(...sizeList.filter(Boolean))
        return [dom.currentSrc, minSize, dom]
      }

      const minSize = Math.min(dom.clientWidth, dom.clientHeight)
      if (dom.tagName === 'VIDEO' && dom.hasAttribute('poster')) {
        return [dom.poster, minSize, dom]
      }

      const backgroundImage = window.getComputedStyle(dom).backgroundImage
      if (backgroundImage === 'none') return null
      const bg = backgroundImage.split(', ')[0]
      if (bg.indexOf('url') === 0 && bg.indexOf('.svg') === -1) {
        const bgUrl = bg.substring(4, bg.length - 1).replace(/['"]/g, '')
        return [bgUrl, minSize, dom]
      }

      return null
    }

    const isImageInfoValid = imageInfo => imageInfo !== null && imageInfo[0] !== '' && imageInfo[0] !== 'about:blank'
    const isNewImageInfoBetter = async (newInfo, oldInfo) => {
      if (oldInfo === null) return true
      if (oldInfo[2].tagName === 'IMG' && newInfo[2].tagName !== 'IMG') return false
      if (!newInfo[0].startsWith('data')) {
        const [newSize, oldSize] = await Promise.all([newInfo[0], oldInfo[0]].map(getImageRealSize))
        return newSize > oldSize
      }
      return false
    }
    const getImageRealSize = url => {
      return new Promise(resolve => {
        const img = new Image()
        img.onload = () => resolve(Math.min(img.naturalWidth, img.naturalHeight))
        img.onerror = () => resolve(0)
        img.src = url
      })
    }
    const markingDom = (function () {
      return window.top === window.self
        ? dom => {
            document.querySelector('.ImageViewerLastDom')?.classList.remove('ImageViewerLastDom')
            dom?.classList.add('ImageViewerLastDom')
          }
        : () => chrome.runtime.sendMessage('reset_dom')
    })()

    return {
      searchDomByPosition: async function (elementList, viewportPos) {
        let firstVisibleDom = null
        let imageInfoFromPoint = null
        let imageDomLayer = 0

        let hiddenImageInfoFromPoint = null
        let hiddenDomLayer = 0

        const maxTry = Math.min(20, elementList.length)
        let index = 0
        let tryCount = 0
        while (tryCount < maxTry) {
          const dom = elementList[index]
          const imageInfo = extractImageInfoFromNode(dom)
          const valid = isImageInfoValid(imageInfo)

          if (dom.offsetParent !== null || dom.style.position === 'fixed') {
            firstVisibleDom ??= dom
            if (valid && (await isNewImageInfoBetter(imageInfo, imageInfoFromPoint))) {
              imageInfoFromPoint = imageInfo
              imageDomLayer = index
              tryCount = Math.max(maxTry - 5, tryCount)
            }
          } else {
            if (valid) {
              hiddenImageInfoFromPoint = imageInfo
              hiddenDomLayer = index
              tryCount = Math.max(maxTry - 5, tryCount)
            }
          }

          index++
          tryCount++
        }

        if (imageInfoFromPoint) {
          console.log(`Image node found, layer ${imageDomLayer}.`)
          markingDom(imageInfoFromPoint[2])
          return imageInfoFromPoint
        }

        if (hiddenImageInfoFromPoint) {
          console.log(`Hidden image node found, layer ${hiddenDomLayer}.`)
          markingDom(hiddenImageInfoFromPoint[2])
          return hiddenImageInfoFromPoint
        }

        const imageInfoFromTree = searchImageFromTree(firstVisibleDom, viewportPos)
        if (isImageInfoValid(imageInfoFromTree)) {
          console.log(`Image node found, hide under sub tree.`)
          markingDom(imageInfoFromTree[2])
          return imageInfoFromTree
        }

        markingDom()
        return null
      }
    }
  })()

  const getOrderedElement = (function () {
    return disableHoverCheck
      ? e => document.elementsFromPoint(e.clientX, e.clientY)
      : async e => {
          const elementsBeforeDisableHover = document.elementsFromPoint(e.clientX, e.clientY)
          document.body.classList.add('disable-hover')
          await new Promise(resolve => setTimeout(resolve, 5))
          document.body.classList.remove('disable-hover')
          const elementsAfterDisableHover = document.elementsFromPoint(e.clientX, e.clientY)

          const stableElements = []
          const unstableElements = []
          for (const elem of elementsBeforeDisableHover) {
            if (elementsAfterDisableHover.includes(elem)) {
              stableElements.push(elem)
            } else {
              unstableElements.push(elem)
            }
          }
          const orderedElements = stableElements.concat(unstableElements)
          return orderedElements
        }
  })()

  function createDataUrl(srcUrl) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({msg: 'get_size', url: srcUrl}).then(res => {
        if (res !== 0) resolve(srcUrl)
      })

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

  document.addEventListener(
    'contextmenu',
    async e => {
      await new Promise(resolve => setTimeout(resolve, 0))
      const viewportPosition = [e.clientX, e.clientY]
      const orderedElements = await getOrderedElement(e)
      const imageNodeInfo = await domSearcher.searchDomByPosition(orderedElements, viewportPosition)
      if (!imageNodeInfo) return

      console.log(imageNodeInfo.pop())
      if (window.top !== window.self) {
        imageNodeInfo[0] = await createDataUrl(imageNodeInfo[0])
      }
      // image size maybe decreased in dataURL
      imageNodeInfo[1] -= 3
      chrome.runtime.sendMessage({msg: 'update_info', data: imageNodeInfo})
    },
    true
  )
})()
