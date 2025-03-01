window.ImageViewer = (function () {
  'use strict'

  let shadowRoot = null
  let lastUpdateTime = 0
  let imageDataList = []
  const imageFailureCountMap = new Map()

  let clearSrc = ''
  let clearIndex = -1
  let lastUrl = location.href
  let lastSrc = ''
  let lastTransform = ''

  const keydownHandlerList = []

  //==========utility==========
  function buildImageNode(data, options) {
    const li = document.createElement('li')
    const img = document.createElement('img')
    li.appendChild(img)

    img.alt = ''
    img.style.transform = 'matrix(1,0,0,1,0,0)'
    if (options.referrerPolicy) img.referrerPolicy = 'no-referrer'
    if (options.cors) img.crossOrigin = 'anonymous'

    img.src = data.src
    if (data.dom.tagName === 'IFRAME') {
      img.setAttribute('data-iframe-src', data.dom.src)
      img.referrerPolicy = 'no-referrer'
    }

    return li
  }

  function closeImageViewer() {
    const root = shadowRoot.host
    if (!root) return

    document.body.classList.remove('iv-attached')
    clearSrc = ''
    clearIndex = -1
    const current = shadowRoot.querySelector('li.current img')
    lastSrc = current?.src || ''
    lastTransform = current?.style?.transform || ''
    keydownHandlerList.length = 0

    const viewer = shadowRoot.querySelector('#image-viewer')
    viewer.addEventListener('transitionend', () => root.remove())
    viewer.style.transition = 'opacity 0.2s'
    viewer.style.opacity = '0'
  }

  function VtoM(scaleX, scaleY, rotate, moveX, moveY) {
    const m = [0, 0, 0, 0, 0, 0]
    const deg = Math.PI / 180
    m[0] = scaleX * Math.cos(rotate * deg)
    m[1] = scaleY * Math.sin(rotate * deg)
    m[2] = -scaleX * Math.sin(rotate * deg)
    m[3] = scaleY * Math.cos(rotate * deg)
    m[4] = moveX
    m[5] = moveY
    return `matrix(${m})`
  }
  function MtoV(str) {
    const match = str.match(/matrix\([\d.+-e, ]+\)/)
    if (!match) return [1, 1, 0, 0, 0]
    const m = match[0].slice(7, -1).split(',').map(Number)
    // https://www.w3.org/TR/css-transforms-1/#decomposing-a-2d-matrix
    let row0x = m[0]
    let row0y = m[2]
    let row1x = m[1]
    let row1y = m[3]
    const moveX = m[4]
    const moveY = m[5]
    let scaleX = Math.sqrt(row0x * row0x + row0y * row0y)
    let scaleY = Math.sqrt(row1x * row1x + row1y * row1y)
    const determinant = row0x * row1y - row0y * row1x
    if (determinant < 0) {
      scaleX = -scaleX
    }
    if (determinant === 0) {
      scaleX = 1
      scaleY = 1
    }
    if (scaleX) {
      row0x *= 1 / scaleX
      row0y *= 1 / scaleX
    }
    if (scaleY) {
      row1x *= 1 / scaleY
      row1y *= 1 / scaleY
    }
    const rotate = Math.atan2(row0y, row0x)
    return [scaleX, scaleY, (rotate / Math.PI) * 180, moveX, moveY]
  }

  const getRawUrl = (function () {
    const getRawUrl = window.ImageViewerUtils?.getRawUrl
    if (typeof getRawUrl === 'function') return getRawUrl

    const cachedExtensionMatch = (function () {
      const extensionRegex = /(.*?[=.](?:jpeg|jpg|png|gif|webp|bmp|tiff|avif))(?!\/)/i
      const matchCache = new Map()
      return str => {
        if (str.startsWith('data') || str.startsWith('blob')) return null

        const cache = matchCache.get(str)
        if (cache !== undefined) return cache

        const extensionMatch = str.match(extensionRegex)
        matchCache.set(str, extensionMatch)
        return extensionMatch
      }
    })()
    const cachedUrlSearchMatch = (function () {
      const urlSearchCache = new Map()
      return src => {
        try {
          // protocol-relative URL
          const url = new URL(src, document.baseURI)
          if (!url.search) return null

          const baseURI = url.origin + url.pathname
          const searchList = url.search
            .slice(1)
            .split('&')
            .filter(t => cachedExtensionMatch(t))
            .join('&')
          const imgSearch = searchList ? '?' + searchList : ''
          const rawSearch = baseURI + imgSearch

          const extensionMatch = cachedExtensionMatch(rawSearch)
          urlSearchCache.set(src, extensionMatch)
          return extensionMatch
        } catch (error) {
          urlSearchCache.set(src, null)
          return null
        }
      }
    })()
    const cachedGetFilename = (function () {
      const filenameCache = new Map()
      return str => {
        if (str.startsWith('data') || str.startsWith('blob')) return null

        const cache = filenameCache.get(str)
        if (cache !== undefined) return cache

        const rawFilename = str.replace(/[-_]\d{3,4}x(?:\d{3,4})?\./, '.')
        filenameCache.set(str, rawFilename)
        return rawFilename
      }
    })()

    const rawUrlCache = new Map()
    return src => {
      if (src.startsWith('data') || src.startsWith('blob')) return src

      const cache = rawUrlCache.get(src)
      if (cache !== undefined) return cache

      const rawFilenameUrl = cachedGetFilename(src)
      if (rawFilenameUrl !== src) {
        rawUrlCache.set(src, rawFilenameUrl)
        return rawFilenameUrl
      }

      const searchMatch = cachedUrlSearchMatch(src)
      const rawSearchUrl = searchMatch?.[1]
      if (rawSearchUrl && rawSearchUrl !== src) {
        rawUrlCache.set(src, rawSearchUrl)
        return rawSearchUrl
      }

      const extensionMatch = cachedExtensionMatch(src)
      const rawExtensionUrl = extensionMatch?.[1]
      if (rawExtensionUrl && rawExtensionUrl !== src) {
        rawUrlCache.set(src, rawExtensionUrl)
        return rawExtensionUrl
      }

      rawUrlCache.set(src, src)
      return src
    }
  })()
  const getFilename = (function () {
    const getFilename = window.ImageViewerUtils?.getFilename
    if (typeof getFilename === 'function') return getFilename

    const rawFilenameCache = new Map()
    return src => {
      const cache = rawFilenameCache.get(src)
      if (cache !== undefined) return cache

      const filename = src.split('?')[0].split('/').at(-1).split('.')[0]
      rawFilenameCache.set(src, filename)
      return filename
    }
  })()

  function searchImgNode(img) {
    const imgUrl = img.src
    const dom = imageDataList.find(data => data.src === imgUrl)?.dom
    if (dom && dom.getRootNode({composed: true}) === document) return dom

    const iframeSrc = img.getAttribute('data-iframe-src')
    if (iframeSrc) {
      return [...document.getElementsByTagName('iframe')].find(iframe => iframe.src === iframeSrc)
    }

    let lastNode = null
    let lastSize = 0
    const updateLargestNode = node => {
      const {width, height} = node.getBoundingClientRect()
      const currSize = Math.min(width, height)
      if (currSize > lastSize) {
        lastSize = currSize
        lastNode = node
      }
    }
    const checkImage = () => {
      const candidateList = []
      const filename = getFilename(imgUrl)
      for (const img of document.getElementsByTagName('img')) {
        if (imgUrl === img.currentSrc || imgUrl === getRawUrl(img.currentSrc)) updateLargestNode(img)
        if (filename === getFilename(img.src)) candidateList.push(img)
      }
      if (!lastNode && candidateList.length !== 0 && candidateList.length <= 2) candidateList.forEach(updateLargestNode)
      return lastNode
    }
    const checkVideo = () => {
      for (const video of document.getElementsByTagName('video')) {
        if (imgUrl === video.poster) updateLargestNode(video)
      }
      return lastNode
    }
    const checkBackground = () => {
      const targetList = window.ImageViewerUtils ? document.body.querySelectorAll('*:not([no-bg])') : document.body.getElementsByTagName('*')
      for (const node of targetList) {
        const backgroundImage = window.getComputedStyle(node).backgroundImage
        if (backgroundImage === 'none') continue
        const bgList = backgroundImage.split(', ').filter(bg => bg.startsWith('url') && !bg.endsWith('.svg")'))
        if (bgList.length !== 0 && imgUrl === bgList[0].slice(5, -2)) updateLargestNode(node)
      }
      return lastNode
    }

    // search image on document
    if (!dom) return checkImage() || checkVideo() || checkBackground()
    else if (dom.tagName === 'IMG') return checkImage()
    else if (dom.tagName === 'VIDEO') return checkVideo()
    else if (!dom.tagName.includes('-')) return checkBackground()
    return null
  }
  function searchNearestPageImgNode(img) {
    const imgList = [...shadowRoot.querySelectorAll('img')]
    const imgUrlList = imgList.map(img => img.src)
    const imgFilenameList = imgUrlList.map(src => getFilename(src))

    const pageImgList = [...document.getElementsByTagName('img')].filter(img => img.clientWidth > 0 && img.clientHeight > 0)
    const pageImgUrlList = pageImgList.map(img => getRawUrl(img.src))
    const pageImgFilenameList = pageImgList.map(img => getFilename(img.src))

    const indexList = []
    for (let i = 0; i < pageImgUrlList.length; i++) {
      const url = pageImgUrlList[i]
      const urlIndex = imgUrlList.indexOf(url)
      if (urlIndex !== -1) {
        indexList.push(urlIndex)
      } else {
        const filename = pageImgFilenameList[i]
        const filenameIndex = imgFilenameList.indexOf(filename)
        indexList.push(filenameIndex)
      }
    }

    const currentIndex = imgUrlList.indexOf(img.src)
    let nearestSrc = null
    let nearestFilename = null
    let lastDistance = imgUrlList.length
    let lastSize = 0
    for (let i = 0; i < indexList.length; i++) {
      const index = indexList[i]
      const currDistance = Math.abs(currentIndex - index)
      if (lastDistance < currDistance) continue

      const {width, height} = pageImgList[i].getBoundingClientRect()
      const currSize = Math.min(width, height)
      if ((nearestSrc === imgUrlList[index] || nearestFilename === imgFilenameList[index]) && currSize <= lastSize) continue

      nearestSrc = imgUrlList[index]
      nearestFilename = imgFilenameList[index]
      lastDistance = currDistance
      lastSize = currSize
    }

    const pageUrlIndex = pageImgUrlList.indexOf(nearestSrc)
    const pageIndex = pageUrlIndex !== -1 ? pageUrlIndex : pageImgFilenameList.indexOf(nearestFilename)
    const nearestPageNode = pageImgList[pageIndex]
    return nearestPageNode
  }
  async function deepSearchImgNode(img) {
    const newNodeObserver = new MutationObserver(async () => {
      if (typeof release === 'function') {
        newNodeObserver.disconnect()
        await new Promise(resolve => setTimeout(resolve, 100))
        release()
        newNodeObserver.observe(document.body, {childList: true, subtree: true})
      }
    })
    newNodeObserver.observe(document.body, {childList: true, subtree: true})

    let release = null
    let repeatCount = 0
    let overtime = false
    let lastNearest = null
    while (true) {
      const imgNode = searchImgNode(img)
      if (imgNode !== null || repeatCount > 5 || overtime) {
        newNodeObserver.disconnect()
        return imgNode
      }
      const nearest = searchNearestPageImgNode(img)
      nearest?.scrollIntoView({behavior: 'instant', block: 'center'})
      nearest !== lastNearest ? (lastNearest = nearest) : repeatCount++
      overtime = await new Promise(resolve => {
        release = () => resolve(false)
        setTimeout(() => resolve(true), 3000)
      })
    }
  }

  const fitFuncDict = (function () {
    // calculate document size is very slow
    let windowWidth = document.documentElement.clientWidth
    let windowHeight = document.compatMode === 'CSS1Compat' ? document.documentElement.clientHeight : document.body.clientHeight
    let windowRatio = windowWidth / windowHeight
    window.addEventListener('resize', () => {
      windowWidth = document.documentElement.clientWidth
      windowHeight = document.compatMode === 'CSS1Compat' ? document.documentElement.clientHeight : document.body.clientHeight
      windowRatio = windowWidth / windowHeight
    })
    function both(imageWidth, imageHeight) {
      const imgRatio = imageWidth / imageHeight
      const maxWidth = Math.min(imageWidth * 3, windowWidth)
      const maxHeight = Math.min(imageHeight * 3, windowHeight)
      return imgRatio >= windowRatio ? [maxWidth, maxWidth / imgRatio] : [maxHeight * imgRatio, maxHeight]
    }
    function width(imageWidth, imageHeight) {
      const imgRatio = imageWidth / imageHeight
      const maxWidth = Math.min(imageWidth * 3, windowWidth)
      return [maxWidth, maxWidth / imgRatio]
    }
    function height(imageWidth, imageHeight) {
      const imgRatio = imageWidth / imageHeight
      const maxHeight = Math.min(imageWidth * 3, windowHeight)
      return [maxHeight * imgRatio, maxHeight]
    }
    function keep(imageWidth, imageHeight) {
      if (windowWidth >= imageWidth && windowHeight >= imageHeight) return [imageWidth, imageHeight]
      const imgRatio = imageWidth / imageHeight
      return imgRatio >= windowRatio ? [windowWidth, windowWidth / imgRatio] : [windowHeight * imgRatio, windowHeight]
    }
    function none(imageWidth, imageHeight) {
      return [imageWidth, imageHeight]
    }
    const dict = {both, width, height, keep, none}
    return dict
  })()

  //==========html&style==========
  const frame = (widthText, heightText) => {
    return `<ul id="iv-image-list"></ul>
      <nav id="iv-control">
        <ul id="iv-index">
          <li><button id="iv-control-prev"></button></li>
          <li><button id="iv-control-next"></button></li>
          <li id="iv-counter"><span id="iv-counter-current">1</span><span>/</span><span id="iv-counter-total">1</span></li>
        </ul>
        <ul id="iv-control-buttons">
          <li><button data-fit="both" id="iv-control-both"></button></li>
          <li><button data-fit="width" id="iv-control-width"></button></li>
          <li><button data-fit="height" id="iv-control-height"></button></li>
          <li><button data-fit="none" id="iv-control-none"></button></li>
          <li><button id="iv-control-moveto"></button></li>
        </ul>
        <ul id="iv-info">
          <li><span>${widthText}</span><span>:</span><span id="iv-info-width"></span></li>
          <li><span>${heightText}</span><span>:</span><span id="iv-info-height"></span></li>
        </ul>
      </nav>
      <button id="iv-control-close"></button>`
  }

  const style = () => {
    return `/* global */
      :host {
        all: initial !important;
      }
      * {
        margin: 0;
        padding: 0;
        color: #ddd;
        font-family: Verdana, Helvetica, Arial, sans-serif;
        user-select: none;
        -webkit-user-drag: none;
      }

      /* root container */
      #image-viewer {
        position: fixed;
        top: 0;
        left: 0;
        z-index: 2147483647;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8) !important;
      }

      /* image list */
      #iv-image-list {
        width: 100%;
        height: 100%;
        transition: 0s;
      }
      #iv-image-list li {
        position: absolute;
        cursor: move;
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
        overflow: hidden;
        translate: 100% 0;
      }
      #iv-image-list li.current {
        translate: 0 0;
      }
      img {
        max-width: 100%;
        max-height: 100%;
        transition: transform 0.05s linear;
      }
      img.loaded {
        max-width: none;
        max-height: none;
      }

      /* control panel */
      #iv-control {
        position: fixed;
        bottom: 0;
        width: 100%;
        height: 60px;
        background: rgba(0, 0, 0, 0);
      }
      #iv-control * {
        opacity: 0;
      }
      #iv-control.show,
      #iv-control.show * {
        background: rgba(0, 0, 0, 0.8);
        opacity: 1;
      }
      #iv-control ul {
        height: 50px;
        margin: 5px 0;
        list-style: none;
      }
      #iv-control span {
        font-weight: normal;
        line-height: normal;
      }

      /* control panel buttons */
      #iv-control button {
        cursor: pointer;
        position: relative;
        width: 50px;
        height: 50px;
        margin: 0 5px;
        border: 0;
        border-radius: 5px;
        box-shadow: inset 0 0 2px #fff;
      }
      #iv-control button:hover {
        box-shadow: inset 0 0 10px #fff;
      }
      #iv-control button:active,
      #iv-control button.on {
        box-shadow: inset 0 0 20px #fff;
      }

      /* control panel layout */
      #iv-index {
        position: absolute;
        left: 10px;
        top: 0;
        display: none;
        opacity: 1;
        z-index: 1;
      }
      #iv-control-buttons {
        display: flex;
        justify-content: center;
      }
      #iv-info {
        position: absolute;
        right: 10px;
        top: 0;
        height: 44px !important;
        padding: 3px 0;
      }

      /* index */
      #iv-index li {
        height: 50px;
      }
      #iv-counter {
        align-content: center;
        opacity: 1;
      }
      #iv-counter span {
        font-size: 20px;
        text-shadow: -1px -1px 0 #000, 0 -1px 0 #000, 1px -1px 0 #000, 1px 0 0 #000, 1px 1px 0 #000, 0 1px 0 #000, -1px 1px 0 #000, -1px 0 0 #000;
        opacity: 0.5;
      }

      /* image info */
      #iv-info li {
        height: 22px;
        display: flex;
      }
      #iv-info span {
        font-size: 16px;
        margin: 0 2px;
      }
      #iv-info span:last-child {
        display: inline-block;
        width: 80px;
        text-align: center;
        border: 1px transparent dashed;
        border-radius: 5px;
      }
      #iv-info span:last-child:hover {
        border-color: #aaa;
      }

      /* close button */
      #iv-control-close {
        cursor: pointer;
        position: absolute;
        right: -50px;
        top: -50px;
        width: 100px;
        height: 100px;
        background: #fff;
        border: 0;
        border-radius: 50%;
        box-shadow: inset 0 0 0 #fff;
        opacity: 0.8;
        visibility: hidden;
      }
      #iv-control-close.show {
        visibility: visible;
      }
      #iv-control-close:before,
      #iv-control-close:after {
        content: '';
        position: absolute;
        left: 50%;
        margin-left: -20px;
        margin-top: 5px;
        background: #999;
        width: 5px;
        height: 30px;
      }
      #iv-control-close:before {
        transform: rotate(-45deg);
      }
      #iv-control-close:after {
        transform: rotate(45deg);
      }

      /* navigation button */
      #iv-index button:after {
        content: '';
        position: absolute;
        margin-top: -12px;
        display: block;
        border-style: solid;
      }
      #iv-control-prev:after {
        left: 50%;
        margin-left: -10px;
        border-width: 12px 18px 12px 0;
        border-color: transparent #787878 transparent transparent;
      }
      #iv-control-next:after {
        right: 50%;
        margin-right: -10px;
        border-width: 12px 0 12px 18px;
        border-color: transparent transparent transparent #787878;
      }

      /* control button */
      #iv-control-both {
        background: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAA2ZpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMy1jMDExIDY2LjE0NTY2MSwgMjAxMi8wMi8wNi0xNDo1NjoyNyAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iIHhtbG5zOnN0UmVmPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VSZWYjIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtcE1NOk9yaWdpbmFsRG9jdW1lbnRJRD0ieG1wLmRpZDpFMjlCMEFGMTRDQzZFMTExOEZFQUQ0QkNGMDJGMzg3NyIgeG1wTU06RG9jdW1lbnRJRD0ieG1wLmRpZDpCQ0YxQUQ0NEM2NTAxMUUxQjgzRUY4RjM0QUVGODRFQyIgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDpCQ0YxQUQ0M0M2NTAxMUUxQjgzRUY4RjM0QUVGODRFQyIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgQ1M2IChXaW5kb3dzKSI+IDx4bXBNTTpEZXJpdmVkRnJvbSBzdFJlZjppbnN0YW5jZUlEPSJ4bXAuaWlkOkUzOUIwQUYxNENDNkUxMTE4RkVBRDRCQ0YwMkYzODc3IiBzdFJlZjpkb2N1bWVudElEPSJ4bXAuZGlkOkUyOUIwQUYxNENDNkUxMTE4RkVBRDRCQ0YwMkYzODc3Ii8+IDwvcmRmOkRlc2NyaXB0aW9uPiA8L3JkZjpSREY+IDwveDp4bXBtZXRhPiA8P3hwYWNrZXQgZW5kPSJyIj8++nwS+AAABB1JREFUeNrsnUtoE0EcxicaRaFKQQ8+oHqoGlvwcfNoRVBP2ouIl9ZLDz4OVqkGi1ZaWInaiyIiHrxo9eDjpMWL4llRRG2LIthDLVghYqk1BOM37ERimmQ3uzObbPJ98DFtMrPJ/n/7n53N7uxGMpmMoKpH8xgCAqEIhEAoj4qGfQXi8XgERQLusSwrwwypvPbDJ1UZekXCPOxFdixCMQKvhb/AMWTJLDOkcjquYEitgbuZIZXLjhUoxuClOS//hNcjSyaZIcGrPw+G1BL4K7us4LNjM4pDJd7fQiDBahCe7/A+gQSUHXtR7HCo1oZ6+wjEPIwFKC66rJ5A/YUEYlZH4XUu68p6RzjsNZcdy1B8ghvLaJaEmzEM/s4M0a++MmEIVb+PGaI/OzaieCu8/RiahjchS0aYIfp0WXj/ZTqq2jNDAsicgl8e2RDhcQhFIARCEQiBUARCEQiBUARCIBSBEAhFIARCEQhFIARCEQiBUD4VZQj8KR6P+2pvWZaZDMEXa4Gf1CETuc4tVZMhgLAcxXm4q04zbje8E74Bn4OnKgJEXch8DO4V5V9RWItd/2H4IDwAX4FTge3UAaMdxXv4EmH8p0YVExmbduMZAhBbhT0ZZjtjX1LN8AP4ubAnor7WCgQgVqpU7PSSVWOjo3Ne2xCLaa1XTZ+bI7nhvoRvqa7dcf5jyUtJAWKxInwabuCG70vT8AXVw/wqNuyNFgEhr409oBbQxFhqUYPqZbrUBn4XzrjdqUuKdwjDiJpUbAfLGWV1qyHcOOOnXeMqtt2ugci76sBD+DOmdkbTjKOWfUiviulQoe7KcaeeN8qaYEx9aVWhUZarnXqBRnJBETfHIZ0dHRHTQ81svWITdrLfwdTn5m2spbZoM8chOWDkgtvUkXpCHQA5fulC0l3PbRuTn5sjOVu4B34YyE8nACM/qFXYNw5Lsjf6p6SKSasXGJ6BKCgpWE6mlBP0rwl7tmu9Kq1iIGMhY5LyuiDf50MAZQqWd0yQd+gZrkMYw2rdZQym/C5M2/kLQPmAYk8dAtG6zjynXmXiOXX/PYNghtSwCIRAKAIhEIpACIQiEAKhCIRAKAKhCIRAKAIhEIpACIQikHpWWJ6O8Fj4u7rjqWVZu5gh+nRCeL8QL63as8vSJfXsj+sem99E+3cEol99ovzriH/AZ7lTN5Ml8jlS/WU2G0C7bwRiTlfhjy7rfhb2HRU47DWYJfKq8h6X1eUD738TiHkoj1A8c6j2AvXu88AwOMlpYn8c3ueReoBZ8kbYt6so9v4rAgleZ8Tc6dry/9UhXqfwAkEWTAr71h+5SuD1CQKpnOR8vuzdJsZFiB4gWZNAkA2zKE5luzD8PxN2ILUwg+oevA2+XQPrEu5Hr9aieIKKQCgCIRDKq/4KMACWrCf3M5jnFgAAAABJRU5ErkJggg==) !important;
        background-size: cover !important;
      }
      #iv-control-width {
        background: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAA2ZpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMy1jMDExIDY2LjE0NTY2MSwgMjAxMi8wMi8wNi0xNDo1NjoyNyAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iIHhtbG5zOnN0UmVmPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VSZWYjIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtcE1NOk9yaWdpbmFsRG9jdW1lbnRJRD0ieG1wLmRpZDpFMjlCMEFGMTRDQzZFMTExOEZFQUQ0QkNGMDJGMzg3NyIgeG1wTU06RG9jdW1lbnRJRD0ieG1wLmRpZDpDMUY5QUJENEM2NTAxMUUxOUIyQ0IyMkFFREYxRUMyRCIgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDpDMUY5QUJEM0M2NTAxMUUxOUIyQ0IyMkFFREYxRUMyRCIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgQ1M2IChXaW5kb3dzKSI+IDx4bXBNTTpEZXJpdmVkRnJvbSBzdFJlZjppbnN0YW5jZUlEPSJ4bXAuaWlkOkUzOUIwQUYxNENDNkUxMTE4RkVBRDRCQ0YwMkYzODc3IiBzdFJlZjpkb2N1bWVudElEPSJ4bXAuZGlkOkUyOUIwQUYxNENDNkUxMTE4RkVBRDRCQ0YwMkYzODc3Ii8+IDwvcmRmOkRlc2NyaXB0aW9uPiA8L3JkZjpSREY+IDwveDp4bXBtZXRhPiA8P3hwYWNrZXQgZW5kPSJyIj8++tXJrAAAAnNJREFUeNrsnM8rBGEch3ckpfbg4MLBiWwc5D9wcODoJhdOeyCXTbKlpNRKuCgHJyecOHL0BygnWuXkwGUPe1BqU+Pz1jeF/TG7M8tknqc+vZN2h/k+768xNZ7v+ymIDx2UACGAEIQAQhACCEEIIAQhgBBACEIAIQgBhCAEEIIQQAggBCGAEIQAQhACCEEIIAQQghBACEIAIQgBhCAEEAIIiTedlCAc+Xw+1PcLhUJ7Roj+sBHlMoFO3DWPxGaESEKvmk0lm9ARN6VMKkfKhlL6EyES0aVmWVlXepj6U4vKnLKlHCiVX1vUJWNGzZ2yi4wv9FhNXG1m2j5CJGJczb4yQe3rMqicK9dKTrmNVIhE9NlQXGhlVD0Uiz9+NpzJ/IvPNcB13Bvl2Kb2l0Zf8Oq9nkkius3wmpKm44fiVdm2Geat1ra3s4YIT82snWCAWkZC2maZrHXwM8UPuqg7iyfIaAsDVtv9ZnZZOdvCPVG/yHmy2uYCC9G85iunOszYYvRKHSNZQ9atpqfVpquGi/q3XdYzNQ1Ff7VdVqBFvcqX3Im8IPchC/Pz3n/d4lb7nGpSr0c3fR/itfJWUrtT37EboO/yvCR1+xpCHpVV5SJAZw//rxOdxP2iUWVFKTMbfVK2mowGkdHMLiuIlIqyp8Mh5VB5T7CId6uBq4WrSaXVE4V+HiIpJWVJh2PKVQJlXNm1uxqUwp4ssucXknKvZjqBQiK9Zp6pxwyPd7/HC0YIQgAhCAGEIAQQghBACEIAIYAQhABCEAIIQQggBCGAEEAIQgAhCAGEIAQQghBACCAEIYAQhABCEAIIQQggBBAScz4EGADyS6Iw76d4WwAAAABJRU5ErkJggg==) !important;
        background-size: cover !important;
      }
      #iv-control-height {
        background: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAA2ZpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMy1jMDExIDY2LjE0NTY2MSwgMjAxMi8wMi8wNi0xNDo1NjoyNyAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iIHhtbG5zOnN0UmVmPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VSZWYjIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtcE1NOk9yaWdpbmFsRG9jdW1lbnRJRD0ieG1wLmRpZDpFMjlCMEFGMTRDQzZFMTExOEZFQUQ0QkNGMDJGMzg3NyIgeG1wTU06RG9jdW1lbnRJRD0ieG1wLmRpZDpCOTg0RTgyNEM2NTAxMUUxQTRGQ0VBQ0ZFNDI0NzUwNSIgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDpCOTg0RTgyM0M2NTAxMUUxQTRGQ0VBQ0ZFNDI0NzUwNSIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgQ1M2IChXaW5kb3dzKSI+IDx4bXBNTTpEZXJpdmVkRnJvbSBzdFJlZjppbnN0YW5jZUlEPSJ4bXAuaWlkOkUzOUIwQUYxNENDNkUxMTE4RkVBRDRCQ0YwMkYzODc3IiBzdFJlZjpkb2N1bWVudElEPSJ4bXAuZGlkOkUyOUIwQUYxNENDNkUxMTE4RkVBRDRCQ0YwMkYzODc3Ii8+IDwvcmRmOkRlc2NyaXB0aW9uPiA8L3JkZjpSREY+IDwveDp4bXBtZXRhPiA8P3hwYWNrZXQgZW5kPSJyIj8+0DCtRAAAAndJREFUeNrsncFLFFEcx9/mBl0UoUvQIQ8aCVIdu8V2CU968u45L1YoixALBhMLdalDhw5ePPQPdOjQoXsgokgUgh5KECFRREWcvo99QSyxOzPNvPEtnw/8+O3OvCeuH76zs+vhV4nj2MDF4RJ/AoQAQhACGamG/gLq9XpFramai6IoJiHlM6V66nrwVEK+7VU6rqhtqIZUW6pbSskxCSmPWSfDckP1mISUl45ral9VA38dPlDdVEp2SIh/FttkWPpVP7lk+U/HHbXpDufvIsQvr1R9Xc4jxFM6JtQedFlW07pJ3tSLl3FZbV01kmD5N9WY3uBPSUhxzCSUYdy6RySkuHRcVfuuGkyx7ZdqWCnZIyH500gpw7j1DRKSfzpG1VZNti9Dz1S3lZINEpIfL032b6arbj8J8ZCcf/7ySkOFzyGAEIQAQhACCAGEIAQQghBACEIAIQgBhABCEAIIQQggBCGAEIQAQgAhCAGEIAQQghBACEIAIYAQhABCEAIIQQggBCGAEIQAQgAhCAGEIAQQghBACEIAIYAQhABCEAIIQQh4JJTpCB/Uxv/jR3yMoughCcmPJ6Y1diILZ24/l6y8cLM/3mbc/k771xCSPw3TGmGUhn3VM97Ui0mJnSO1mHLbc+3bRUhxvDGtcXhJ2FS95ra32JTYmYRzCZfbgfcn3Pb6uQ3+pFbrsOSzZNzng6E/7Nz08y7n+aTu8dK1orbU4fwXhPhnQXXYdsw+vx7wawpXiFKwo/ai7XBTx38gpDzswMht93jbBDRAsieFKA3HavN/LmF6fhS6kKoJn/eqe6rlHngtYY9e7UX4BxVCACEIgaz8FmAAavyUc1I71hUAAAAASUVORK5CYII=) !important;
        background-size: cover !important;
      }
      #iv-control-none {
        background: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAA2ZpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMy1jMDExIDY2LjE0NTY2MSwgMjAxMi8wMi8wNi0xNDo1NjoyNyAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iIHhtbG5zOnN0UmVmPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VSZWYjIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtcE1NOk9yaWdpbmFsRG9jdW1lbnRJRD0ieG1wLmRpZDpFMjlCMEFGMTRDQzZFMTExOEZFQUQ0QkNGMDJGMzg3NyIgeG1wTU06RG9jdW1lbnRJRD0ieG1wLmRpZDpCNTE3QTJGNEM2NTAxMUUxOTdBNjg0RjY1RThFQ0QwMiIgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDpCNTE3QTJGM0M2NTAxMUUxOTdBNjg0RjY1RThFQ0QwMiIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgQ1M2IChXaW5kb3dzKSI+IDx4bXBNTTpEZXJpdmVkRnJvbSBzdFJlZjppbnN0YW5jZUlEPSJ4bXAuaWlkOkUzOUIwQUYxNENDNkUxMTE4RkVBRDRCQ0YwMkYzODc3IiBzdFJlZjpkb2N1bWVudElEPSJ4bXAuZGlkOkUyOUIwQUYxNENDNkUxMTE4RkVBRDRCQ0YwMkYzODc3Ii8+IDwvcmRmOkRlc2NyaXB0aW9uPiA8L3JkZjpSREY+IDwveDp4bXBtZXRhPiA8P3hwYWNrZXQgZW5kPSJyIj8+EIJY5QAAASxJREFUeNrs3UEOgjAQQFFrvHRP0GMPrIkmQKG25f2lRqO80IEIMUXES/30tgmACAgQAQEiIEAEBIiACAgQAQEiIEAEBIiACAgQAQEiIEDUrM/RF+Sca689TR1uh6rvVEpJ9hBLloAA0XBDfTvA1iF/y6Bs3N6hHPYQS5aACAgQAXnEYW/HxYnDWHvITRAx8DnQVCDxz5M4IIa6gAAZunTyOSCNUYY97J3lPCRN8j3MECACAkRAgAgIEAEBIiACAkRAgAjI9M3yA9X2kh8XynWE8euxIUpH/2Hngtuid32uCow73qe6vbdOmyGWLAEB0m4GXjA/xh7qX4b8ow9712HdF4gsWUAEBIiACAgQAQEiIEAEBIiACAgQAQEiIEAEBIiACAgQAQGiS1oEGACl7SnD1JcJ0wAAAABJRU5ErkJggg==) !important;
        background-size: cover !important;
      }
      #iv-control-moveto {
        background: url(data:image/png;base64,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) !important;
        background-size: cover !important;
      }`
  }

  //==========function define==========
  function buildApp(options) {
    const shadowHolder = document.createElement('div')
    shadowHolder.id = 'image-viewer-root'
    shadowRoot = shadowHolder.attachShadow({mode: 'closed'})

    const stylesheet = document.createElement('style')
    stylesheet.textContent = style()
    const viewer = document.createElement('div')
    viewer.id = 'image-viewer'
    viewer.tabIndex = 0

    if (chrome.i18n?.getMessage) {
      const widthText = chrome.i18n.getMessage('width') || 'Width'
      const heightText = chrome.i18n.getMessage('height') || 'Height'
      viewer.innerHTML = frame(widthText, heightText)
    } else {
      viewer.innerHTML = frame('Width', 'Height')
    }

    if (!options.closeButton) {
      viewer.style.setProperty('background', 'rgb(0, 0, 0)', 'important')
      // prevent image loading flash
      viewer.style.setProperty('opacity', '0')
    }

    if (options.canvasMode) {
      viewer.style.setProperty('background', 'rgb(255, 255, 255)', 'important')
    }

    shadowRoot.append(stylesheet)
    shadowRoot.append(viewer)
    document.body.appendChild(shadowHolder)
    document.body.classList.add('iv-attached')
  }

  function buildImageList(imageList, options) {
    const _imageList = shadowRoot.querySelector('#iv-image-list')
    const fragment = document.createDocumentFragment()
    imageList.map(data => buildImageNode(data, options)).forEach(li => fragment.appendChild(li))
    _imageList.appendChild(fragment)

    imageDataList = Array.from(imageList)
    lastUpdateTime = Date.now()

    if (imageList.length === 1) return
    shadowRoot.querySelector('#iv-index').style.display = 'flex'
    shadowRoot.querySelector('#iv-counter-total').textContent = imageList.length
  }

  function initImageList(options) {
    function updateCounter() {
      const list = [...shadowRoot.querySelectorAll('#iv-image-list li')]
      const length = list.length
      if (length === 0) {
        closeImageViewer()
        return
      }

      const current = shadowRoot.querySelector('li.current')
      const currIndex = list.indexOf(current)

      counterTotal.textContent = length
      counterCurrent.textContent = currIndex + 1
    }
    function removeFailedImg() {
      const action = img => {
        // update counter
        const src = img.src
        const lastCount = imageFailureCountMap.get(src) || 0
        imageFailureCountMap.set(src, lastCount + 1)
        if (lastCount < 3) {
          fetch(src, {cache: 'reload'}).catch(() => {})
          img.src = src
          return
        }
        // update data list
        const index = imageDataList.findIndex(data => data.src === src)
        if (index !== -1) imageDataList.splice(index, 1)
        // set new current
        const target = img.parentNode
        if (target.classList.contains('current')) {
          target.previousSibling?.classList.add('current')
        }
        // remove img container
        target.remove()
        updateCounter()
      }

      for (const img of shadowRoot.querySelectorAll('img:not(.loaded, .loading)')) {
        if (img.complete && img.naturalWidth === 0) {
          action(img)
          continue
        }
        img.classList.add('loading')
        img.addEventListener('error', () => action(img))
      }
    }

    const liList = [...shadowRoot.querySelectorAll('#iv-image-list li')]
    const current = shadowRoot.querySelector('#iv-image-list li.current')
    const baseIndex = current ? liList.indexOf(current) : clearIndex !== -1 ? clearIndex : options.index || 0
    const base = current || liList[baseIndex] || liList[0]
    base.classList.add('current')

    const baseImg = base.firstChild
    const targetSrc = clearSrc || lastSrc
    const src = baseImg.src
    if (lastTransform && (targetSrc === src || getFilename(targetSrc) === getFilename(src))) {
      baseImg.style.transition = 'none'
      baseImg.style.transform = lastTransform
    }
    lastTransform = ''

    const counterTotal = shadowRoot.querySelector('#iv-counter-total')
    const counterCurrent = shadowRoot.querySelector('#iv-counter-current')
    updateCounter()

    let completeFlag = false
    if (baseImg.complete) {
      shadowRoot.querySelector('#iv-info-width').textContent = baseImg.naturalWidth
      shadowRoot.querySelector('#iv-info-height').textContent = baseImg.naturalHeight
    }
    baseImg.addEventListener('load', () => {
      baseImg.style.transition = ''
      // prevent image loading flash
      if (!options.closeButton) {
        const viewer = shadowRoot.querySelector('#image-viewer')
        viewer.style.removeProperty('opacity')
      }
      shadowRoot.querySelector('#iv-info-width').textContent = baseImg.naturalWidth
      shadowRoot.querySelector('#iv-info-height').textContent = baseImg.naturalHeight
      if (!completeFlag) removeFailedImg()
      completeFlag = true
    })
    setTimeout(() => {
      if (!completeFlag) removeFailedImg()
      completeFlag = true
    }, 3000)
  }

  function fitImage(options, reset = true, update = false) {
    const fitFunc = fitFuncDict[options.fitMode] || fitFuncDict.both
    const action = img => {
      const [w, h] = fitFunc(img.naturalWidth, img.naturalHeight)
      img.width = w
      img.height = h
      img.classList.add('loaded')
      img.classList.remove('loading')
    }
    const liList = shadowRoot.querySelectorAll(`#iv-image-list li${update ? ':not(.ready)' : ''}`)
    for (const li of liList) {
      const img = li.firstChild
      if (img.naturalWidth) action(img)
      else img.addEventListener('load', () => action(img))
    }
    if (reset) {
      const event = new CustomEvent('resetTransform')
      for (const li of liList) {
        li.dispatchEvent(event)
      }
    }
  }

  function addFrameEvent(options) {
    const viewer = shadowRoot.querySelector('#image-viewer')
    function initKeydownHandler() {
      if (document.body.classList.contains('iv-ready')) return
      document.body.classList.add('iv-ready')
      let ctrlWithAltGraph = false
      window.addEventListener(
        'keydown',
        e => {
          if (!document.body.classList.contains('iv-attached')) return
          ctrlWithAltGraph = e.getModifierState('AltGraph') && e.key === 'Control' ? true : ctrlWithAltGraph
          e.ctrlWithAltGraph = ctrlWithAltGraph
          keydownHandlerList.forEach(func => func(e))
        },
        true
      )
      window.addEventListener(
        'keyup',
        e => {
          ctrlWithAltGraph = e.getModifierState('AltGraph') && e.key === 'Control' ? false : ctrlWithAltGraph
        },
        true
      )
    }
    function addImageReverseSearchHotkey() {
      function checkKey(e, hotkey) {
        const keyList = hotkey.split('+').map(str => str.trim())
        const key = keyList[keyList.length - 1] === e.key.toUpperCase()
        const ctrl = keyList.includes('Ctrl') === e.ctrlKey || e.ctrlWithAltGraph
        const alt = keyList.includes('Alt') === (e.altKey || e.getModifierState('AltGraph'))
        const shift = keyList.includes('Shift') === e.shiftKey
        return key && ctrl && alt && shift
      }

      function readDateUrl(dataURL) {
        const [header, data] = dataURL.split(',')
        const mime = header.split(':')[1].split(';')[0]
        const decodedData = atob(data)
        const buffer = new ArrayBuffer(decodedData.length)
        const view = new Uint8Array(buffer)
        for (let i = 0; i < decodedData.length; i++) {
          view[i] = decodedData.charCodeAt(i)
        }
        return [buffer, mime]
      }
      async function fetchImageBuffer(imgUrl) {
        if (imgUrl.startsWith('data')) {
          return readDateUrl(imgUrl)
        }
        if (imgUrl.startsWith('blob')) {
          const res = await fetch(imgUrl)
          if (!res.ok) {
            alert('failed to load this blob image')
            throw new Error('failed to load this blob image')
          }
          const blob = await res.blob()
          const arrayBuffer = await blob.arrayBuffer()
          const buffer = new Uint8Array(arrayBuffer)
          const mime = res.headers.get('content-type').split(';')[0] || 'image/jpeg'
          return [buffer, mime]
        }
        if (imgUrl.startsWith('file')) {
          if (!extensionMode) {
            alert('local image is not supported in non-extension mode')
            throw new Error('local image is not supported in non-extension mode')
          }
          const [dataUrl, mime] = await chrome.runtime.sendMessage({msg: 'request_cors_url', url: imgUrl})
          const res = await fetch(dataUrl)
          const rawArray = await res.arrayBuffer()
          const buffer = new Uint8Array(rawArray)
          return [buffer, mime]
        }
        alert('unknown protocol')
        throw new Error('unknown protocol')
      }

      const imageBufferCache = new Map()
      async function getImageBuffer(imgUrl) {
        if (imageBufferCache.has(imgUrl)) {
          return imageBufferCache.get(imgUrl)
        }
        const promise = fetchImageBuffer(imgUrl)
        imageBufferCache.set(imgUrl, promise)
        return promise
      }
      async function sendImageByForm(imgUrl, endpoint, felidName) {
        const [buffer, mime] = await getImageBuffer(imgUrl)

        const form = document.createElement('form')
        const fileInput = document.createElement('input')
        const submitInput = document.createElement('input')

        form.action = endpoint
        form.method = 'POST'
        form.target = '_blank'
        form.enctype = 'multipart/form-data'
        form.style.display = 'none'
        form.appendChild(fileInput)
        form.appendChild(submitInput)

        fileInput.name = felidName
        fileInput.type = 'file'
        submitInput.type = 'submit'

        const container = new DataTransfer()
        const file = new File([buffer], 'iv-image.jpg', {type: mime})
        container.items.add(file)
        fileInput.files = container.files

        document.body.appendChild(form)
        submitInput.click()
        document.body.removeChild(form)
      }

      function searchImageByGoogle(imgUrl) {
        if (!extensionMode) {
          alert('google image search is not supported in non-extension mode')
          return
        }
        // temporarily disabled google lens search on data and blob images
        if (imgUrl.startsWith('file')) {
          sendImageByForm(imgUrl, 'https://lens.google.com/v3/upload', 'encoded_image')
        } else {
          chrome.runtime.sendMessage({msg: 'google_search', src: imgUrl})
        }
      }
      async function searchImageByYandex(imgUrl) {
        const [buffer, mime] = await getImageBuffer(imgUrl)
        const endpoint = 'https://yandex.ru/images-apphost/image-download?cbird=111&images_avatars_size=preview&images_avatars_namespace=images-cbir'
        const blob = new Blob([buffer], {type: mime})
        const res = await fetch(endpoint, {method: 'POST', body: blob})
        if (!res.ok) return

        const json = await res.json()
        const originalImageUrl = json.url.replace(/\/preview$/, '/orig')
        const cbirID = json.image_shard + '/' + json.image_id
        const url = `https://yandex.ru/images/search?rpt=imageview&url=${encodeURIComponent(originalImageUrl)}&cbir_id=${encodeURIComponent(cbirID)}`
        openNewTab(url)
      }
      function searchImageBySaucenao(imgUrl) {
        sendImageByForm(imgUrl, 'https://saucenao.com/search.php', 'file')
      }
      function searchImageByAscii2d(imgUrl) {
        sendImageByForm(imgUrl, 'https://ascii2d.net/search/file', 'file')
      }

      const extensionMode = !!chrome.runtime?.id
      const openNewTab = extensionMode ? url => chrome.runtime.sendMessage({msg: 'open_tab', url: url}) : url => window.open(url, '_blank')
      const getCurrentUrl = () => shadowRoot.querySelector('li.current img').src

      if (!options.searchHotkey || options.searchHotkey.length < 5) return
      const hotkey = options.searchHotkey
      const googleUrl = 'https://lens.google.com/uploadbyurl?url={imgSrc}'
      const yandexUrl = 'https://yandex.ru/images/search?family=yes&rpt=imageview&url={imgSrc}'
      const saucenaoUrl = 'https://saucenao.com/search.php?db=999&url={imgSrc}'
      const ascii2dUrl = 'https://ascii2d.net/search/url/{imgSrc}'
      const urlList = [googleUrl, yandexUrl, saucenaoUrl, ascii2dUrl]
      const searchImageFunctionList = [searchImageByGoogle, searchImageByYandex, searchImageBySaucenao, searchImageByAscii2d]

      keydownHandlerList.push(async e => {
        for (let i = urlList.length - 1; i >= 0; i--) {
          if (hotkey[i] === '' || !checkKey(e, hotkey[i])) continue

          e.preventDefault()
          const imgUrl = getCurrentUrl()
          if (imgUrl.startsWith('http')) {
            const queryUrl = urlList[i].replace('{imgSrc}', encodeURIComponent(imgUrl))
            openNewTab(queryUrl)
            return
          }
          const searchDataImage = searchImageFunctionList[i]
          searchDataImage(imgUrl)
          return
        }
      })

      keydownHandlerList.push(async e => {
        if (!checkKey(e, hotkey[4])) return
        e.preventDefault()
        const imgUrl = getCurrentUrl()
        const isNormalImage = imgUrl.startsWith('http')
        if (isNormalImage) {
          for (let i = urlList.length - 1; i >= 0; i--) {
            const queryUrl = urlList[i].replace('{imgSrc}', encodeURIComponent(imgUrl))
            openNewTab(queryUrl)
          }
          return
        }
        for (let i = urlList.length - 1; i >= 0; i--) {
          const searchDataImage = searchImageFunctionList[i]
          searchDataImage(imgUrl)
        }
      })

      const customHotkey = hotkey.slice(5)
      const customUrl = options.customUrl
      if (customHotkey.length !== customUrl.length) return
      keydownHandlerList.push(e => {
        for (let i = customHotkey.length - 1; i >= 0; i--) {
          if (customHotkey[i] === '' || !checkKey(e, customHotkey[i])) continue

          e.preventDefault()
          const imgUrl = getCurrentUrl()
          if (!imgUrl.startsWith('http')) {
            alert('Only support image with url for custom search service')
            return
          }
          const queryUrl = customUrl[i].replace('{imgSrc}', encodeURIComponent(imgUrl))
          openNewTab(queryUrl)
          break
        }
      })
    }
    function addChangeBackgroundHotkey() {
      const backgroundList = [
        ['rgb(0, 0, 0)', 'important'],
        ['rgb(255, 255, 255)', 'important']
      ]
      if (options.closeButton) backgroundList.unshift([''])
      if (options.canvasMode) backgroundList.sort((a, b) => b[0].length - a[0].length)
      let index = 0
      keydownHandlerList.push(e => {
        if (!e.shiftKey || e.key.toUpperCase() !== 'B') return
        index = (index + 1) % backgroundList.length
        shadowRoot.querySelector('#image-viewer').style.setProperty('background', ...backgroundList[index])
      })
    }
    function addTransformationHotkey() {
      const keyMap = {
        ArrowUp: 0,
        w: 0,
        ArrowDown: 1,
        s: 1,
        ArrowLeft: 2,
        a: 2,
        ArrowRight: 3,
        d: 3
      }
      let lastHotkeyTime = 0
      keydownHandlerList.push(e => {
        if (!(e.altKey || e.getModifierState('AltGraph')) || e.shiftKey) return
        const action = keyMap[e.key]
        if (action === undefined) return
        const now = Date.now()
        if (e.repeat && now - lastHotkeyTime < 30) return
        lastHotkeyTime = now
        e.preventDefault()
        const type = e.ctrlKey || e.ctrlWithAltGraph ? 'move' : action < 2 ? 'zoom' : 'rotate'
        const data = {detail: {type: type, action: action}}
        const event = new CustomEvent('hotkey', data)
        const current = shadowRoot.querySelector('li.current')
        current.dispatchEvent(event)
      })
    }
    function addControlPanelHideEvent() {
      const controlPanel = shadowRoot.querySelector('#iv-control')
      const navigationButtonList = shadowRoot.querySelectorAll('#iv-index button')
      const controlButtonList = shadowRoot.querySelectorAll('#iv-control-buttons button')
      const buttonList = [...navigationButtonList, ...controlButtonList]

      let displayTimeout = 0
      controlPanel.addEventListener('mouseenter', () => {
        controlPanel.classList.add('show')
        clearTimeout(displayTimeout)
        displayTimeout = setTimeout(() => controlPanel.classList.remove('show'), 1500)
      })
      controlPanel.addEventListener('mouseleave', () => {
        controlPanel.classList.remove('show')
        clearTimeout(displayTimeout)
      })
      for (const button of buttonList) {
        button.addEventListener('mouseenter', () => {
          controlPanel.classList.add('show')
          clearTimeout(displayTimeout)
          displayTimeout = setTimeout(() => controlPanel.classList.remove('show'), 1500)
        })
      }
    }
    function addFitButtonEvent() {
      const currFitBtn = shadowRoot.querySelector(`#iv-control-${options.fitMode}`)
      currFitBtn?.classList.add('on')
      const fitBtnList = shadowRoot.querySelectorAll('#iv-control-buttons button[data-fit]')
      for (const fitBtn of fitBtnList) {
        fitBtn.addEventListener('click', () => {
          fitBtnList.forEach(btn => btn.classList.remove('on'))
          fitBtn.classList.add('on')
          options.fitMode = fitBtn.getAttribute('data-fit')
          fitImage(options)
        })
      }
      window.addEventListener('resize', () => fitImage(options))
    }
    function addMoveToButtonEvent() {
      function displayBorder(imgNode) {
        const border = document.createElement('div')
        border.style.position = 'fixed'
        border.style.top = '0px'
        border.style.left = '0px'
        border.style.border = '5px solid red'
        border.style.boxSizing = 'border-box'
        border.style.zIndex = '2147483647'
        border.style.pointerEvents = 'none'
        document.body.appendChild(border)

        let endFlag = false
        let lastTop = NaN
        let lastLeft = NaN
        const drawBorder = () => {
          if (endFlag) return
          const {top, left, width, height} = imgNode.getBoundingClientRect()
          if (top !== lastTop || left !== lastLeft) {
            lastTop = top
            lastLeft = left
            border.style.transform = `translate(${left - 1}px, ${top - 1}px)`
            border.style.width = `${width + 4}px`
            border.style.height = `${height + 4}px`
          }
          requestAnimationFrame(drawBorder)
        }
        drawBorder()
        setTimeout(() => {
          endFlag = true
          border.remove()
        }, 1000)
      }
      function getMainContainer() {
        const windowWidth = document.documentElement.clientWidth
        const windowHeight = document.compatMode === 'CSS1Compat' ? document.documentElement.clientHeight : document.body.clientHeight
        const targetList = document
          .elementsFromPoint(windowWidth / 2, windowHeight / 2)
          .slice(0, -2)
          .filter(n => n.scrollHeight > n.clientHeight)
        let container = null
        let currHeight = 0
        for (const node of targetList) {
          const overflowY = window.getComputedStyle(node).overflowY
          if (overflowY !== 'auto' && overflowY !== 'scroll') continue
          if (node.scrollHeight > currHeight) {
            container = node
            currHeight = node.scrollHeight
          }
          // only want topmost element
          if (currHeight >= window.innerHeight) break
        }
        return container || document.documentElement
      }
      async function moveTo() {
        const current = shadowRoot.querySelector('#iv-counter-current')
        const total = shadowRoot.querySelector('#iv-counter-total')
        const currIndex = Number(current.textContent) - 1
        const imageListLength = Number(total.textContent)
        closeImageViewer()

        const htmlTemp = document.documentElement.style.scrollBehavior
        const bodyTemp = document.body.style.scrollBehavior
        document.documentElement.style.scrollBehavior = 'auto'
        document.body.style.scrollBehavior = 'auto'

        const ratio = currIndex / imageListLength
        const totalHeight = document.body.scrollHeight || document.documentElement.scrollHeight
        const targetTop = totalHeight * ratio
        const container = getMainContainer()
        container.scrollTo(container.scrollLeft, targetTop)
        await new Promise(resolve => setTimeout(resolve, 100))

        const img = shadowRoot.querySelector('li.current img')
        let imgNode = searchImgNode(img)
        if (imgNode === null) {
          await new Promise(resolve => setTimeout(resolve, 100))
          imgNode = searchImgNode(img)
        }
        if (imgNode === null) {
          imgNode = await deepSearchImgNode(img)
          if (imgNode === null) {
            console.log('Image node not found')
            return
          }
        }
        // check visibility by offsetParent
        if (imgNode.offsetParent === null && imgNode.style.position !== 'fixed') {
          console.log('Image node not visible')
        }
        console.log('Move to image node')
        let currentY = -1
        while (currentY !== container.scrollTop) {
          currentY = container.scrollTop
          imgNode.scrollIntoView({behavior: 'instant', block: 'center'})
        }
        await new Promise(resolve => setTimeout(resolve, 50))
        document.documentElement.style.scrollBehavior = htmlTemp
        document.body.style.scrollBehavior = bodyTemp
        displayBorder(imgNode)
      }

      shadowRoot.querySelector('#iv-control-moveto').addEventListener('click', moveTo)
      keydownHandlerList.push(e => {
        if (e.ctrlKey || e.altKey || e.getModifierState('AltGraph') || e.shiftKey) return
        if (e.key === 'Enter') {
          e.preventDefault()
          moveTo()
        }
      })
    }
    function addCloseButtonEvent() {
      const closeButton = shadowRoot.querySelector('#iv-control-close')
      closeButton.classList.add('show')
      closeButton.addEventListener('click', closeImageViewer)
      closeButton.addEventListener('contextmenu', e => {
        e.preventDefault()
        chrome.runtime?.id ? chrome.runtime.sendMessage('close_tab') : window.close()
      })
      keydownHandlerList.push(e => {
        if (e.ctrlKey || e.altKey || e.getModifierState('AltGraph') || e.shiftKey) return
        if (e.key === 'Escape' || e.key === '"NumpadAdd"') {
          e.preventDefault()
          closeImageViewer()
        }
      })
    }
    function addMiddleClickKeyEvent() {
      function searchImgAnchor() {
        const img = shadowRoot.querySelector('li.current img')
        const imgNode = searchImgNode(img)
        if (!imgNode || imgNode.tagName === 'IFRAME') return null

        const closestAnchor = imgNode.closest('a')
        if (closestAnchor) return closestAnchor

        const siblingAnchor = [...imgNode.parentElement.children].find(node => node?.tagName === 'A')
        if (siblingAnchor) return siblingAnchor

        if (imgNode.parentElement.tagName !== 'DIV') {
          const treeAnchorList = imgNode.parentElement.getElementsByTagName('a')
          if (treeAnchorList.length === 1) return treeAnchorList[0]
        }

        const containerAnchorList = imgNode.closest('div')?.getElementsByTagName('a')
        if (containerAnchorList?.length === 1) return containerAnchorList[0]

        const {width: rootWidth, height: rootHeight, top: rootTop, left: rootLeft} = imgNode.getBoundingClientRect()
        let el = imgNode.parentElement
        while (el) {
          const anchorList = el.querySelectorAll(':scope > * > a')
          for (const anchor of anchorList) {
            const {width, height, top, left} = anchor.getBoundingClientRect()
            const include = top <= rootTop && left <= rootLeft && top + height >= rootTop + rootHeight && left + width >= rootLeft + rootWidth
            if (include) return anchor
          }
          el = el.parentElement
        }

        return null
      }
      const openNewTab = chrome.runtime?.id ? anchor => chrome.runtime.sendMessage({msg: 'open_tab', url: anchor.href}) : anchor => window.open(anchor.href, '_blank')
      const dispatchEvent = anchor => anchor.dispatchEvent(new MouseEvent('click', {button: 1, which: 2}))

      keydownHandlerList.push(e => {
        if (e.ctrlKey || e.altKey || e.getModifierState('AltGraph') || e.shiftKey) return
        if (e.key === 'Insert' || e.key === '0' || e.key === ' ') {
          e.preventDefault()
          const anchor = searchImgAnchor()
          if (anchor) openNewTab(anchor)
        }
      })
      // call preventDefault to trigger auxclick event
      viewer.addEventListener('mousedown', e => {
        if (e.button === 1) e.preventDefault()
      })
      // browsers map middle click to opening a link in a new tab without switching
      // opening a link in auxclick event handler can do the same job (undocumented?)
      viewer.addEventListener('auxclick', e => {
        if (e.button !== 1) return
        const anchor = searchImgAnchor()
        if (anchor) dispatchEvent(anchor)
      })
    }
    function disableWebsiteDefaultEvent() {
      const disableList = [
        'click',
        'contextmenu',
        'dblclick',
        'keydown',
        'keypress',
        'keyup',
        'mousedown',
        'mouseenter',
        'mouseleave',
        'mousemove',
        'mouseover',
        'mouseup',
        'pointerdown',
        'pointerenter',
        'pointerleave',
        'pointermove',
        'pointerout',
        'pointerover',
        'pointerup',
        'wheel'
      ]

      for (const event of disableList) {
        viewer.addEventListener(event, e => e.stopPropagation())
      }
      keydownHandlerList.push(e => e.stopPropagation())
      viewer.focus()
    }

    initKeydownHandler()
    addImageReverseSearchHotkey()
    addChangeBackgroundHotkey()
    addTransformationHotkey()
    addControlPanelHideEvent()
    addFitButtonEvent()
    if (options.closeButton) {
      addMoveToButtonEvent()
      addCloseButtonEvent()
      addMiddleClickKeyEvent()
      disableWebsiteDefaultEvent()
    }
  }

  function addImageEvent(options) {
    // transform function
    function updateZoom(img, deltaZoom, zoomCount, rotateCount) {
      let [scaleX, scaleY, rotate, moveX, moveY] = MtoV(img.style.transform)
      const mirror = Math.sign(scaleX) * Math.sign(scaleY)
      scaleX = Math.sign(scaleX) * options.zoomRatio ** zoomCount
      scaleY = Math.sign(scaleY) * options.zoomRatio ** zoomCount
      // recalculate displacement for zooming at the center of the viewpoint
      moveX = moveX * options.zoomRatio ** deltaZoom
      moveY = moveY * options.zoomRatio ** deltaZoom
      // rotate value must be reset every time after updating the transform matrix
      rotate = (mirror * options.rotateDeg * rotateCount) % 360
      img.style.transform = VtoM(scaleX, scaleY, rotate, moveX, moveY)
    }
    function updateRotate(img, deltaRotate, rotateCount) {
      let [scaleX, scaleY, rotate, moveX, moveY] = MtoV(img.style.transform)
      const mirror = Math.sign(scaleX) * Math.sign(scaleY)
      // recalculate displacement for rotation around the center of the viewpoint
      const radial = Math.sqrt(moveX ** 2 + moveY ** 2)
      const deltaRadian = ((options.rotateDeg * deltaRotate) / 180) * Math.PI
      const newRadian = Math.atan2(moveY, moveX) + deltaRadian
      moveX = radial * Math.cos(newRadian)
      moveY = radial * Math.sin(newRadian)
      // rotate value must be reset every time after updating the transform matrix
      rotate = (mirror * options.rotateDeg * rotateCount) % 360
      img.style.transform = VtoM(scaleX, scaleY, rotate, moveX, moveY)
    }
    function updateDisplacement(img, deltaX, deltaY, rotateCount) {
      let [scaleX, scaleY, rotate, moveX, moveY] = MtoV(img.style.transform)
      const mirror = Math.sign(scaleX) * Math.sign(scaleY)
      moveX += deltaX
      moveY += deltaY
      rotate = (mirror * options.rotateDeg * rotateCount) % 360
      img.style.transform = VtoM(scaleX, scaleY, rotate, moveX, moveY)
    }

    function addTransformHandler(li) {
      const img = li.firstChild
      let zoomCount = 0
      let rotateCount = 0
      if (li.classList.contains('current')) {
        const [scaleX, , rotate, ,] = MtoV(img.style.transform)
        zoomCount = Math.round(Math.log(scaleX) / Math.log(options.zoomRatio))
        rotateCount = rotate / options.rotateDeg
      }

      // zoom & rotate
      li.addEventListener('wheel', e => {
        e.preventDefault()
        // transition cause flash when high zoom rate
        if (options.zoomRatio ** zoomCount > 2) {
          img.style.transition = 'none'
        } else {
          img.style.transition = ''
        }
        if (!e.altKey && !e.getModifierState('AltGraph')) {
          const deltaZoom = e.deltaY > 0 ? -1 : 1
          zoomCount += deltaZoom
          updateZoom(img, deltaZoom, zoomCount, rotateCount)
        } else {
          // mirror === 1 ? (e.deltaY > 0 ? rotateCount++ : rotateCount--) : e.deltaY > 0 ? rotateCount-- : rotateCount++
          const deltaRotate = (e.deltaY > 0) * 2 - 1
          rotateCount += deltaRotate
          updateRotate(img, deltaRotate, rotateCount)
        }
      })

      // mirror-reflect
      li.addEventListener('click', e => {
        if (!e.altKey && !e.getModifierState('AltGraph')) return
        let [scaleX, scaleY, rotate, moveX, moveY] = MtoV(img.style.transform)
        const mirror = Math.sign(scaleX) * Math.sign(scaleY)
        rotate = (mirror * options.rotateDeg * rotateCount) % 360
        rotateCount *= -1
        img.style.transform = VtoM(-scaleX, scaleY, rotate, -moveX, moveY)
      })

      // dragging
      let dragFlag = false
      let finalDragTimeout = 0
      const lastPos = {x: 0, y: 0}
      li.addEventListener('mousedown', e => {
        e.preventDefault()
        dragFlag = true
        lastPos.x = e.clientX
        lastPos.y = e.clientY
      })
      li.addEventListener('mousemove', e => {
        if (!dragFlag) return
        const deltaX = e.clientX - lastPos.x
        const deltaY = e.clientY - lastPos.y
        lastPos.x = e.clientX
        lastPos.y = e.clientY
        // reset transition
        clearTimeout(finalDragTimeout)
        finalDragTimeout = setTimeout(() => {
          img.style.transition = ''
        }, 30)
        img.style.transition = 'none'
        updateDisplacement(img, deltaX, deltaY, rotateCount)
      })
      li.addEventListener('mouseup', () => (dragFlag = false))

      // reset
      const reset = () => {
        zoomCount = 0
        rotateCount = 0
        img.style.transform = 'matrix(1,0,0,1,0,0)'
      }
      li.addEventListener('dblclick', reset)
      // custom event
      li.addEventListener('resetTransform', reset)

      // handle hotkey
      li.addEventListener('hotkey', e => {
        const {type, action} = e.detail
        switch (type) {
          case 'zoom': {
            const deltaZoom = action === 1 ? -1 : 1
            zoomCount += deltaZoom
            updateZoom(img, deltaZoom, zoomCount, rotateCount)
            break
          }
          case 'rotate': {
            const deltaRotate = action === 3 ? 1 : -1
            rotateCount += deltaRotate
            updateRotate(img, deltaRotate, rotateCount)
            break
          }
          case 'move': {
            const displacement = 50 * ((action % 2) * 2 - 1)
            action > 1 ? updateDisplacement(img, displacement, 0, rotateCount) : updateDisplacement(img, 0, displacement, rotateCount)
            break
          }
          default:
            break
        }
      })
    }

    for (const li of shadowRoot.querySelectorAll('#iv-image-list li:not(.ready)')) {
      li.classList.add('ready')
      addTransformHandler(li)
    }
  }

  function addImageListEvent(options) {
    const imageListNode = shadowRoot.querySelector('#iv-image-list')
    const infoWidth = shadowRoot.querySelector('#iv-info-width')
    const infoHeight = shadowRoot.querySelector('#iv-info-height')
    const current = shadowRoot.querySelector('#iv-counter-current')
    const total = shadowRoot.querySelector('#iv-counter-total')

    const debouncePeriod = options.debouncePeriod ?? 1500
    const throttlePeriod = options.throttlePeriod ?? 80

    let debounceTimeout = 0
    let debounceFlag = false
    let throttleTimestamp = Date.now()
    let autoNavigateFlag = 0
    let moveCount = 0

    // filter navigation call during long paint
    let moveLock = false
    let moveLockPromise = Promise.resolve()

    function moveToNode(index) {
      const currentListItem = imageListNode.querySelector('li.current')
      const relateListItem = imageListNode.querySelector(`li:nth-child(${index + 1})`)
      const relateImage = relateListItem.querySelector('img')
      currentListItem?.classList.remove('current')
      relateListItem.classList.add('current')

      current.textContent = index + 1
      infoWidth.textContent = relateImage.naturalWidth
      infoHeight.textContent = relateImage.naturalHeight
      moveCount++

      const {promise, resolve} = Promise.withResolvers()
      requestAnimationFrame(() => {
        throttleTimestamp = Date.now()
        moveLock = false
        resolve()
      })
      moveLock = true
      moveLockPromise = promise
    }

    function resetTimeout() {
      clearTimeout(debounceTimeout)
      debounceFlag = false
    }
    function prevItem(repeat = false) {
      const currentIndex = Number(current.textContent) - 1
      const imageListLength = Number(total.textContent)
      const prevIndex = currentIndex === 0 ? imageListLength - 1 : currentIndex - 1
      if (!repeat) {
        resetTimeout()
        moveToNode(prevIndex)
        return
      }

      if (prevIndex === imageListLength - 1) {
        if (debounceFlag) return
        const delay = Date.now() - lastUpdateTime > 5000 ? debouncePeriod : 5000
        debounceTimeout = setTimeout(prevItem, delay)
        debounceFlag = true
      } else if (Date.now() >= throttleTimestamp + throttlePeriod) {
        resetTimeout()
        moveToNode(prevIndex)
      }
    }
    function nextItem(repeat = false) {
      const currentIndex = Number(current.textContent) - 1
      const imageListLength = Number(total.textContent)
      const nextIndex = currentIndex >= imageListLength - 1 ? 0 : currentIndex + 1
      if (!repeat) {
        resetTimeout()
        moveToNode(nextIndex)
        return
      }

      if (nextIndex === 0) {
        if (debounceFlag) return
        const delay = Date.now() - lastUpdateTime > 5000 ? debouncePeriod : 5000
        debounceTimeout = setTimeout(nextItem, delay)
        debounceFlag = true
      } else if (Date.now() >= throttleTimestamp + throttlePeriod) {
        resetTimeout()
        moveToNode(nextIndex)
      }
    }

    // key event
    const keyMap = {
      ArrowLeft: 0,
      ArrowUp: 0,
      w: 0,
      a: 0,
      ArrowRight: 1,
      ArrowDown: 1,
      s: 1,
      d: 1
    }
    const normalNavigation = e => {
      if (e.ctrlKey || e.altKey || e.getModifierState('AltGraph') || e.shiftKey) return
      const action = keyMap[e.key]
      if (action !== undefined) {
        e.preventDefault()
        if (moveLock) return
        action === 1 ? nextItem(e.repeat) : prevItem(e.repeat)
      }
    }
    const fastNavigation = e => {
      if (!e.ctrlKey || e.altKey || e.getModifierState('AltGraph') || e.shiftKey) return
      const action = keyMap[e.key]
      if (action !== undefined && e.key.length !== 1) {
        e.preventDefault()
        if (moveLock) return
        const currIndex = Number(current.textContent) - 1
        const newIndex = action === 1 ? Math.min(currIndex + 10, Number(total.textContent) - 1) : Math.max(currIndex - 10, 0)
        moveToNode(newIndex)
      }
    }
    const autoNavigation = async e => {
      if (e.ctrlKey || e.altKey || e.getModifierState('AltGraph') || !e.shiftKey) {
        autoNavigateFlag = 0
        return
      }
      if (e.key === 'Shift') return
      const action = keyMap[e.key]
      if (action === undefined || e.key.length === 1) {
        autoNavigateFlag = 0
        return
      }
      // {0,1} => {0,2} => {-1,1}
      const newFlag = action * 2 - 1
      if (autoNavigateFlag === newFlag) return

      autoNavigateFlag = newFlag
      e.preventDefault()

      let lastMoveCount = moveCount
      while (document.visibilityState === 'visible') {
        // interrupt by user
        if (autoNavigateFlag !== newFlag || lastMoveCount !== moveCount) break

        const currIndex = Number(current.textContent) - 1
        const newIndex = action === 1 ? Math.min(currIndex + 1, Number(total.textContent) - 1) : Math.max(currIndex - 1, 0)
        if (currIndex === newIndex) break

        moveToNode(newIndex)
        lastMoveCount = moveCount
        await moveLockPromise
        await new Promise(resolve => setTimeout(resolve, options.autoPeriod))
      }
      autoNavigateFlag = 0
    }
    keydownHandlerList.push(normalNavigation)
    keydownHandlerList.push(fastNavigation)
    keydownHandlerList.push(autoNavigation)
    // arrow button
    shadowRoot.querySelector('#iv-control-prev').addEventListener('click', prevItem)
    shadowRoot.querySelector('#iv-control-next').addEventListener('click', nextItem)
    // control bar
    shadowRoot.querySelector('#iv-control').addEventListener('wheel', e => {
      e.preventDefault()
      e.deltaY > 0 ? nextItem() : prevItem()
    })
    // close button
    shadowRoot.querySelector('#iv-control-close').addEventListener('wheel', e => {
      e.preventDefault()
      e.deltaY > 0 ? nextItem() : prevItem()
    })
  }

  function updateImageList(newList, options) {
    function tryClear() {
      // failed update will became incorrect insertion
      const invalidImageList = imageDataList.length > newList.length || shadowRoot.querySelectorAll('img').length > imageDataList.length
      if (invalidImageList) {
        const current = shadowRoot.querySelector('li.current img')
        const counterCurrent = shadowRoot.querySelector('#iv-counter-current')
        clearSrc = current.src
        clearIndex = counterCurrent.textContent - 1
        lastTransform = current.style.transform

        imageDataList.length = 0
        const imageListNode = shadowRoot.querySelector('#iv-image-list')
        imageListNode.innerHTML = ''
        buildImageList(newList, options)
        return true
      } else {
        clearSrc = ''
        clearIndex = -1
        return false
      }
    }
    function tryUpdate() {
      for (let i = 0; i < currentUrlList.length; i++) {
        const src = currentUrlList[i]
        const data = imageDataList[i]
        const domData = newDomDataMap.get(data.dom)
        if (domData !== undefined && src !== domData.src) {
          currentUrlList[i] = domData.src
          imgList[i].src = domData.src
          updated = true
          continue
        }
        const rawUrl = getRawUrl(data.src)
        const urlData = newUrlDataMap.get(rawUrl)
        if (src !== rawUrl && urlData !== undefined) {
          currentUrlList[i] = urlData.src
          imgList[i].src = urlData.src
          updated = true
          continue
        }
        const filename = getFilename(data.src)
        const filenameData = newFilenameDataMap.get(filename)
        if (filenameData !== undefined && src !== filenameData.src) {
          currentUrlList[i] = filenameData.src
          imgList[i].src = filenameData.src
          updated = true
        }
      }
    }
    function tryInsert() {
      function insertImageNode(node, index) {
        const list = shadowRoot.querySelectorAll('#iv-image-list li')
        if (index === list.length) {
          imageListNode.appendChild(node)
        } else {
          imageListNode.insertBefore(node, list[index])
        }
      }
      const imageListNode = shadowRoot.querySelector('#iv-image-list')
      const counterCurrent = shadowRoot.querySelector('#iv-counter-current')
      const currentIndex = counterCurrent.textContent - 1
      const currentUrlIndexMap = new Map(currentUrlList.map((url, i) => [url, i]))
      const newUrlInsertIndexMap = new Map()
      let indexShift = 0

      // first image might be new
      const firstData = newList[0]
      const firstIndex = currentUrlIndexMap.get(firstData.src)
      if (firstIndex === undefined) {
        indexShift++
        const node = buildImageNode(firstData, options)
        newUrlInsertIndexMap.set(firstData.src, 0)
        insertImageNode(node, 0)
        updated = true
        if (currentIndex === 0) {
          console.log('First image changed')
          clearIndex = 0
        }
      }
      // process remaining list
      for (let i = 1; i < newList.length; i++) {
        const data = newList[i]
        const index = currentUrlIndexMap.get(data.src)
        if (index !== undefined) continue

        indexShift++
        const node = buildImageNode(data, options)
        const lastSrc = newList[i - 1].src
        // insert to known position
        const refIndex = currentUrlIndexMap.get(lastSrc) + indexShift || newUrlInsertIndexMap.get(lastSrc) + 1
        newUrlInsertIndexMap.set(data.src, refIndex)
        insertImageNode(node, refIndex)
        updated = true
      }
    }
    // function tryRemove() {
    //   const current = shadowRoot.querySelector('li.current img')
    //   const currentSrc = current.src

    //   for (const imgNode of shadowRoot.querySelectorAll('img')) {
    //     if (!newUrlDataMap.has(imgNode.src)) {
    //       imgNode.parentElement.remove()
    //       updated = true
    //     }
    //   }

    //   const rawUrl = getRawUrl(currentSrc)
    //   if (!shadowRoot.contains(current) || rawUrl === currentSrc) return
    //   for (const imgNode of shadowRoot.querySelectorAll('img')) {
    //     if (imgNode.src === rawUrl) {
    //       imgNode.parentElement.classList.add('current')
    //       break
    //     }
    //   }
    // }

    const cleared = tryClear()
    if (cleared) return

    // init update check cache
    const imgList = [...shadowRoot.querySelectorAll('img')]
    const currentUrlList = imgList.map(data => data.src)
    const newDomDataMap = new Map()
    const newUrlDataMap = new Map()
    const newFilenameDataMap = new Map()
    const repeatFilename = new Set()
    for (const data of newList) {
      const {src, dom} = data
      if (dom.tagName !== 'IFRAME') newDomDataMap.set(dom, data)
      newUrlDataMap.set(src, data)

      const filename = getFilename(src)
      if (repeatFilename.has(filename) || newFilenameDataMap.has(filename)) {
        repeatFilename.add(filename)
        newFilenameDataMap.delete(filename)
      } else {
        newFilenameDataMap.set(filename, data)
      }
    }

    let updated = false
    tryUpdate()
    tryInsert()
    // This extension never remove old image from the list
    // fork and uncomment if you need it
    // tryRemove()

    imageDataList = Array.from(newList)
    lastUpdateTime = Date.now()

    if (options.closeButton) {
      shadowRoot.querySelector('#iv-index').style.display = 'flex'
      shadowRoot.querySelector('#iv-counter-total').textContent = imageDataList.length
    }
    if (updated) {
      if (tryClear()) console.log('Image list has been rebuilt')
      else console.log('Image viewer updated')
    }
  }

  function restoreIndex(options) {
    function getRestoreIndex() {
      if (clearIndex === 0 && options.index === undefined) return 0

      const targetSrc = clearSrc || lastSrc
      const current = shadowRoot.querySelector('#iv-image-list li.current')
      if (!targetSrc && current) {
        return [...shadowRoot.querySelectorAll('#iv-image-list li')].indexOf(current)
      }

      const rawUrl = getRawUrl(targetSrc)
      const srcList = imageDataList.map(data => data.src)
      const srcIndex = srcList.findIndex(src => src === targetSrc || src === rawUrl)
      if (srcIndex !== -1) return srcIndex

      const filename = getFilename(targetSrc)
      const filenameIndexList = srcList.map((src, i) => [getFilename(src), i]).filter(item => item[0] === filename)
      if (filenameIndexList.length === 1) return filenameIndexList[0][1]

      return Math.min(clearIndex, imageDataList.length - 1)
    }

    const neededToRestore = clearIndex !== -1 || (options.index === undefined && lastSrc !== '')
    if (!neededToRestore) return

    // reset after url change
    if (lastUrl !== location.href) {
      lastUrl = location.href
      clearSrc = ''
      clearIndex = -1
      lastSrc = ''
      return
    }
    // canvas mode
    if (options.canvasMode) {
      lastSrc = ''
      return
    }

    const newIndex = getRestoreIndex()
    const imageListNode = shadowRoot.querySelector('#iv-image-list')
    const relateListItem = imageListNode.querySelector(`li:nth-child(${newIndex + 1})`)
    const relateImage = relateListItem.querySelector('img')

    imageListNode.querySelector('li.current')?.classList.remove('current')
    relateListItem.classList.add('current')
    shadowRoot.querySelector('#iv-counter-current').textContent = newIndex + 1
    shadowRoot.querySelector('#iv-info-width').textContent = relateImage.naturalWidth
    shadowRoot.querySelector('#iv-info-height').textContent = relateImage.naturalHeight

    clearSrc = ''
    clearIndex = -1
    lastSrc = ''
  }

  function executeCommand(command) {
    switch (command) {
      case 'get_image_list': {
        const currentImageList = shadowRoot.querySelectorAll('img')
        return Array.from(currentImageList)
      }
      case 'get_image_failure_count': {
        return imageFailureCountMap
      }
      case 'reset_image_list': {
        imageDataList = []
        return
      }
      case 'close_image_viewer': {
        closeImageViewer()
        return
      }
      default: {
        console.log(`Invalid command: ${command}`)
      }
    }
  }

  //==========main function==========
  function ImageViewer(imageList, options) {
    // command mode
    if (arguments.length === 1) {
      const command = arguments[0]
      return executeCommand(command)
    }

    if (imageList.length === 0) return

    if (!document.body.classList.contains('iv-attached')) {
      buildApp(options)
      buildImageList(imageList, options)
      initImageList(options)
      fitImage(options, false)
      addFrameEvent(options)
      addImageEvent(options)
      addImageListEvent(options)
      console.log('Image viewer initialized')
    } else {
      updateImageList(imageList, options)
      initImageList(options)
      fitImage(options, false, true)
      addImageEvent(options)
    }
    restoreIndex(options)
  }

  return ImageViewer
})()
