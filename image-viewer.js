window.ImageViewer = (function () {
  'use strict'

  let shadowRoot = null
  let lastUpdateTime = 0
  let currentImageList = []

  let clearFlag = false
  let clearSrc = ''
  let clearIndex = -1
  let lastSrc = ''

  const argsRegex = /(.*?[=.](?:jpeg|jpg|png|gif|webp|bmp|tiff|avif))(?!\/)/i
  const failedImageSet = new Set()
  const rawUrlCache = new Map()
  const rawFilenameCache = new Map()
  const keydownHandlerList = []

  //==========utility==========
  function buildImageNode(data, options) {
    const li = document.createElement('li')
    const img = document.createElement('img')
    li.appendChild(img)

    img.alt = ''
    if (options.referrerPolicy) img.referrerPolicy = 'no-referrer'
    if (options.cors) img.crossOrigin = 'anonymous'

    if (typeof data === 'string') {
      img.src = data
    }
    if (typeof data === 'object') {
      img.src = data[0]
      img.setAttribute('data-iframe-src', data[1])
    }
    return li
  }
  function insertImageNode(node, index) {
    const imageListNode = shadowRoot.querySelector('#iv-image-list')
    const list = shadowRoot.querySelectorAll('#iv-image-list li')

    if (index === list.length) {
      imageListNode.appendChild(node)
    } else {
      imageListNode.insertBefore(node, list[index])
    }
  }

  function closeImageViewer() {
    const current = shadowRoot.querySelector('li.current img')
    lastSrc = current.src
    document.documentElement.classList.remove('has-image-viewer')
    keydownHandlerList.length = 0
    const root = document.querySelector('#image-viewer-root')
    if (root) {
      root.addEventListener('transitionend', root.remove)
      root.style.transition = 'opacity 0.2s'
      root.style.opacity = '0'
    }
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
    return `matrix(${m.map(t => t.toFixed(2))})`
  }
  function MtoV(str) {
    const match = str.match(/matrix\([-\d.e, ]+\)/)
    if (!match) return
    const m = match[0]
      .slice(7, -1)
      .split(',')
      .map(t => Number(t))
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

  function getFilename(src) {
    const cache = rawFilenameCache.get(src)
    if (cache !== undefined) return cache

    const filename = src.split('/').pop().split('?').shift().split('.').shift()
    rawFilenameCache.set(src, filename)
    return filename
  }
  function getRawUrl(src) {
    const cache = rawUrlCache.get(src)
    if (cache !== undefined) return cache

    if (typeof src !== 'string' || src.startsWith('data')) return src
    try {
      // protocol-relative URL
      const url = new URL(src, document.baseURI)
      const baseURI = url.origin + url.pathname

      const searchList = url.search
        .slice(1)
        .split('&')
        .filter(t => t.match(argsRegex))
        .join('&')
      const imgSearch = searchList ? '?' + searchList : ''
      const noSearch = baseURI + imgSearch

      const argsMatch = noSearch.match(argsRegex)
      if (argsMatch) {
        const rawUrl = argsMatch[1]
        if (rawUrl !== src) {
          rawUrlCache.set(src, rawUrl)
          return rawUrl
        }
      }
    } catch (error) {}

    const argsMatch = src.match(argsRegex)
    if (argsMatch) {
      const rawUrl = argsMatch[1]
      if (rawUrl !== src) {
        rawUrlCache.set(src, rawUrl)
        return rawUrl
      }
    }
    rawUrlCache.set(src, src)
    return src
  }
  function searchImgNode(img) {
    const iframeSrc = img.getAttribute('data-iframe-src')
    if (iframeSrc) {
      return [...document.getElementsByTagName('iframe')].find(iframe => iframe.src === iframeSrc)
    }

    const imgUrl = img.src
    const imgFilename = getFilename(img.src)
    const possibleNodeList = []
    let lastSize = 0
    let lastNode = null
    const updateLargestNode = node => {
      const {width, height} = node.getBoundingClientRect()
      const currSize = Math.min(width, height)
      if (currSize > lastSize) {
        lastSize = currSize
        lastNode = node
      }
    }

    for (const img of document.getElementsByTagName('img')) {
      if (imgUrl === img.currentSrc || imgUrl === getRawUrl(img.src)) {
        updateLargestNode(img)
      }
      if (imgFilename === getFilename(img.src)) {
        possibleNodeList.push(img)
      }
    }
    if (lastNode) return lastNode
    if (possibleNodeList.length !== 0 && possibleNodeList.length <= 2) {
      possibleNodeList.map(updateLargestNode)
    }
    if (lastNode) return lastNode

    for (const video of document.getElementsByTagName('video')) {
      if (imgUrl === video.poster) {
        updateLargestNode(video)
      }
    }
    if (lastNode) return lastNode

    for (const node of document.body.getElementsByTagName('*')) {
      const backgroundImage = window.getComputedStyle(node).backgroundImage
      if (backgroundImage === 'none') continue
      const bg = backgroundImage.split(', ')[0]
      if (bg !== 'none' && imgUrl === bg.substring(5, bg.length - 2)) {
        updateLargestNode(node)
      }
    }
    return lastNode
  }
  function searchImgAnchor(imgNode) {
    const closestAnchor = imgNode.closest('a')
    if (closestAnchor) return closestAnchor

    const {width: rootWidth, height: rootHeight, top: rootTop, left: rootLeft} = imgNode.getBoundingClientRect()
    let el = imgNode
    while (el.parentElement) {
      el = el.parentElement
      const anchorList = el.getElementsByTagName('a')
      if (anchorList.length === 1) return anchorList[0]
      for (const anchor of anchorList) {
        const {width, height, top, left} = anchor.getBoundingClientRect()
        const include = top <= rootTop && left <= rootLeft && top + height >= rootTop + rootHeight && left + width >= rootLeft + rootWidth
        if (include) return anchor
      }
    }

    const prevSibling = imgNode.previousElementSibling
    const nextSibling = imgNode.nextElementSibling
    if (prevSibling?.tagName === 'A') return prevSibling
    if (nextSibling?.tagName === 'A') return nextSibling

    return null
  }

  function searchNearestPageImgNode(img) {
    const imgList = [...shadowRoot.querySelectorAll('img')]
    const imgUrlList = imgList.map(img => img.src)
    const imgFilenameList = imgList.map(img => getFilename(img.src))

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
        newNodeObserver.observe(document.documentElement, {childList: true, subtree: true})
      }
    })
    newNodeObserver.observe(document.documentElement, {childList: true, subtree: true})

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
      nearest.scrollIntoView({behavior: 'instant', block: 'center'})
      nearest !== lastNearest ? (lastNearest = nearest) : repeatCount++
      overtime = await new Promise(resolve => {
        release = () => resolve(false)
        setTimeout(() => resolve(true), 3000)
      })
    }
  }
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

    const action = entryList => {
      const entry = entryList[0]
      const rect = entry.intersectionRect
      const {top, left, width, height} = rect
      border.style.transform = `translate(${left - 1}px, ${top - 1}px)`
      border.style.width = `${width + 4}px`
      border.style.height = `${height + 4}px`
      observer.unobserve(imgNode)
    }
    const observer = new IntersectionObserver(action)
    observer.observe(imgNode)

    let count = 0
    let {top, left} = imgNode.getBoundingClientRect()
    const displayFrame = 60
    const fps = 1000 / displayFrame
    const interval = setInterval(() => {
      const {top: currTop, left: currLeft} = imgNode.getBoundingClientRect()
      if (top !== currTop || left !== currLeft || count % 5 === 0) {
        top = currTop
        left = currLeft
        observer.observe(imgNode)
      }
      if (count++ > displayFrame) {
        clearInterval(interval)
        border.remove()
      }
    }, fps)
  }

  function isCurrentListBad(newList) {
    if (!clearFlag) return false
    clearFlag = false

    if (currentImageList.length > newList.length) return true
    for (const img of currentImageList) {
      if (typeof img === 'string' && newList.indexOf(img) === -1) return true
    }
    return false
  }
  function restoreIndex(options) {
    const neededToRestore = clearIndex !== -1 || (options.index === undefined && lastSrc !== '')
    if (!neededToRestore) return

    const current = shadowRoot.querySelector('#iv-counter-current')
    const imageListNode = shadowRoot.querySelector('#iv-image-list')
    const infoWidth = shadowRoot.querySelector('#iv-info-width')
    const infoHeight = shadowRoot.querySelector('#iv-info-height')

    const srcIndex = currentImageList.indexOf(clearSrc || lastSrc)
    const newIndex = clearIndex === 0 ? 0 : srcIndex === -1 ? Math.max(clearIndex, 0) : srcIndex

    current.innerHTML = newIndex + 1

    imageListNode.style.translate = `0 ${-newIndex * 100}%`
    imageListNode.querySelector('li.current')?.classList.remove('current')

    const relateListItem = imageListNode.querySelector(`li:nth-child(${newIndex + 1})`)
    relateListItem.classList.add('current')

    const relateImage = relateListItem.querySelector('img')
    infoWidth.value = relateImage.naturalWidth
    infoHeight.value = relateImage.naturalHeight

    clearSrc = ''
    clearIndex = -1
    lastSrc = ''
  }

  const fitFuncDict = (function () {
    function both() {
      const windowWidth = document.documentElement.clientWidth
      const windowHeight = document.compatMode === 'CSS1Compat' ? document.documentElement.clientHeight : document.body.clientHeight
      const windowRatio = windowWidth / windowHeight
      return (imageWidth, imageHeight) => {
        const imgRatio = imageWidth / imageHeight
        return imgRatio >= windowRatio ? [windowWidth, windowWidth / imgRatio] : [windowHeight * imgRatio, windowHeight]
      }
    }
    function width() {
      const windowWidth = document.documentElement.clientWidth
      return (imageWidth, imageHeight) => {
        const imgRatio = imageWidth / imageHeight
        return [windowWidth, windowWidth / imgRatio]
      }
    }
    function height() {
      const windowHeight = document.doctype ? document.documentElement.clientHeight : document.body.clientHeight
      return (imageWidth, imageHeight) => {
        const imgRatio = imageWidth / imageHeight
        return [windowHeight * imgRatio, windowHeight]
      }
    }
    function none() {
      return (imageWidth, imageHeight) => [imageWidth, imageHeight]
    }
    const dict = {both: both, width: width, height: height, none: none}
    return {
      get: function (funcName) {
        const fitFuncFactory = dict[funcName]
        return fitFuncFactory ? fitFuncFactory() : null
      }
    }
  })()

  //==========html&style==========
  const frame = () => {
    return `<ul id="iv-image-list"></ul>
    <nav id="iv-control">
      <div id="iv-index">
        <ul>
          <li><button id="iv-control-prev">Previous</button></li>
          <li><button id="iv-control-next">Next</button></li>
        </ul>
        <p id="iv-counter"><span id="iv-counter-current">1</span><span>/</span><span id="iv-counter-total">1</span></p>
      </div>
      <ul id="iv-control-buttons">
        <li><button data-fit="both" id="iv-control-both"></button></li>
        <li><button data-fit="width" id="iv-control-width"></button></li>
        <li><button data-fit="height" id="iv-control-height"></button></li>
        <li><button data-fit="none" id="iv-control-none"></button></li>
        <li><button id="iv-control-moveto"></button></li>
      </ul>
      <ul id="iv-info">
        <li>
          <span class="label"><span data-i18n="width">Width</span>: </span><input id="iv-info-width">
        </li>
        <li>
          <span class="label"><span data-i18n="height">Height</span>: </span><input id="iv-info-height">
        </li>
      </ul>
    </nav>
    <button id="iv-control-close">Close</button>`
  }

  const style = () => {
    return `* {
        user-select: none;
        -webkit-user-drag: none;
      }
      #image-viewer * {
        margin: 0;
        padding: 0;
      }

      #image-viewer {
        position: fixed;
        left: 0;
        top: 0;
        z-index: 2147483647;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8) !important;
      }

      #iv-image-list {
        width: 100%;
        height: 100%;
        padding: 0;
        margin: 0;
        position: absolute;
        left: 0;
        top: 0;
        transition: 0s;
      }
      #iv-image-list li {
        cursor: move;
        width: 100%;
        height: 100%;
        list-style: none;
        position: relative;
        overflow: hidden;
      }
      #iv-image-list li img {
        position: absolute;
        margin: auto;
        left: 0px;
        right: 0px;
        top: 0px;
        bottom: 0px;
        max-width: 100%;
        max-height: 100%;
        text-align: center;
      }
      #iv-image-list li img.loaded {
        max-width: none;
        max-height: none;
      }

      #iv-control {
        position: fixed;
        left: 0;
        bottom: 0;
        width: 100%;
        height: 60px;
        background: rgba(0, 0, 0, 0);
        border-top: 0px #333 solid;
      }
      #iv-control * {
        visibility: hidden;
      }
      #iv-control:hover,
      #iv-control:hover * {
        background: rgba(0, 0, 0, 0.8);
        visibility: visible;
      }
      #iv-control button {
        cursor: pointer;
        width: 50px;
        height: 50px;
        border: 0;
        white-space: nowrap;
        text-indent: 150%;
        overflow: hidden;
        position: relative;
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

      #iv-info {
        position: absolute;
        right: 10px;
        top: -5px;
        margin-top: 5px;
      }
      #iv-info li {
        list-style: none;
      }
      #iv-info .label {
        display: inline-block;
        width: 70px;
        text-align: right;
        margin-right: 5px;
        font-family: Verdana, Helvetica, Arial, sans-serif;
        color: #ddd;
        font-size: 16px;
        font-weight: 400;
      }
      #iv-info input {
        background: none;
        border: 1px transparent dashed;
        border-radius: 5px;
        width: 70px;
        text-align: center;
        padding: 0 5px;
        font-family: Verdana, Helvetica, Arial, sans-serif;
        color: #ddd;
        font-size: 16px;
        font-weight: 400;
      }
      #iv-info input:hover {
        border-color: #aaa;
      }

      #iv-control-close {
        display: none;
        position: absolute;
        right: -50px;
        top: -50px;
        cursor: pointer;
        width: 100px;
        height: 100px;
        border: 0;
        white-space: nowrap;
        text-indent: 150%;
        overflow: hidden;
        background: #fff;
        opacity: 0.8;
        border-radius: 50%;
        box-shadow: inset 0 0 0 #fff;
      }
      #iv-control-close.show {
        display: block;
      }
      #iv-control-close:before,
      #iv-control-close:after {
        content: '';
        display: block;
        position: absolute;
        left: 50%;
        top: 50%;
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

      #iv-index {
        position: absolute;
        left: 10px;
        top: 0;
        margin-top: 5px;
        display: none;
      }
      #iv-index ul {
        display: inline-block;
      }
      #iv-index li {
        list-style: none;
        display: inline-block;
        width: 50px;
        margin: 0 5px;
      }
      #iv-index li button:after {
        content: '';
        position: absolute;
        top: 50%;
        margin-top: -12px;
        display: block;
        width: 0px;
        height: 0px;
        border-style: solid;
      }

      #iv-counter,
      #iv-counter span {
        display: inline-block;
        font-family: Verdana, Helvetica, Arial, sans-serif;
        color: #fff;
        text-shadow: -1px -1px 0 #000, 0 -1px 0 #000, 1px -1px 0 #000, 1px 0 0 #000, 1px 1px 0 #000, 0 1px 0 #000, -1px 1px 0 #000, -1px 0 0 #000;
        font-size: 20px;
        font-weight: 400;
        visibility: visible;
      }
      #iv-counter {
        opacity: 0.5;
      }
      #iv-control:hover #iv-counter, #iv-counter span{
        opacity: 1;
        color: #ddd;
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
      #iv-control-buttons {
        display: flex;
        justify-content: center;
        margin: 5px auto 0;
      }
      #iv-control-buttons li {
        list-style: none;
        display: inline-block;
        width: 50px;
        margin: 0 5px;
      }
      #iv-control-buttons li button:after {
        content: attr(data-tooltip);
        position: absolute;
        top: -50px;
      }

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
  function buildApp() {
    document.documentElement.classList.add('has-image-viewer')

    const shadowHolder = document.createElement('div')
    shadowHolder.style.all = 'revert'
    shadowHolder.id = 'image-viewer-root'
    shadowRoot = shadowHolder.attachShadow({mode: 'closed'})
    // shadowRoot = shadowHolder.attachShadow({mode: 'open'})
    document.body.appendChild(shadowHolder)

    const stylesheet = document.createElement('style')
    stylesheet.innerHTML = style()
    const viewer = document.createElement('div')
    viewer.id = 'image-viewer'
    viewer.tabIndex = 0
    viewer.innerHTML = frame()

    shadowRoot.append(stylesheet)
    shadowRoot.append(viewer)
    viewer.focus()

    try {
      for (const node of shadowRoot.querySelectorAll('[data-i18n]')) {
        const msg = chrome.i18n.getMessage(node.getAttribute('data-i18n'))
        if (msg) {
          node.innerHTML = msg
          if (node.value !== '') node.value = msg
        }
      }
    } catch (e) {}
  }

  function buildImageList(imageList, options) {
    const _imageList = shadowRoot.querySelector('#iv-image-list')
    const first = buildImageNode(imageList[0], options)
    _imageList.appendChild(first)
    currentImageList = Array.from(imageList)
    lastUpdateTime = Date.now()

    if (imageList.length === 1) return
    shadowRoot.querySelector('#iv-index').style.display = 'inline'
    shadowRoot.querySelector('#iv-counter-total').innerHTML = imageList.length
    for (let i = 1; i < imageList.length; i++) {
      const li = buildImageNode(imageList[i], options)
      _imageList.appendChild(li)
    }
  }

  function initImageList(options) {
    function updateCounter() {
      const list = [...shadowRoot.querySelectorAll('#iv-image-list li')]
      const length = list.length
      if (length === 0) {
        closeImageViewer()
        return
      }

      const translate = shadowRoot.querySelector('#iv-image-list').style.translate
      const translateY = translate.slice(4, -1)
      const lastIndex = translateY ? Number(translateY) / -100 : 0
      const current = shadowRoot.querySelector('li.current') || list[Math.min(length - 1, lastIndex)]
      const currIndex = list.indexOf(current)

      counterTotal.innerHTML = length
      counterCurrent.innerHTML = currIndex + 1
      imageListNode.style.translate = `0 ${-currIndex * 100}%`
    }
    function removeFailedImg() {
      const action = e => {
        const img = e?.target ?? e
        const ratio = options.minWidth / options.minHeight - 1
        const sign = Math.sign(ratio)
        const [adjustWidth, adjustHeight] = [img.naturalWidth, img.naturalHeight].sort((a, b) => sign * (b - a))
        if (adjustWidth === 0 || adjustHeight === 0 || adjustWidth < options.minWidth || adjustHeight < options.minHeight) {
          const currentUrlList = []
          for (const data of currentImageList) {
            const url = typeof data === 'string' ? data : data[0]
            currentUrlList.push(url)
          }
          const src = img.src
          const index = currentUrlList.indexOf(src)
          currentImageList.splice(index, 1)
          failedImageSet.add(src)
          img.parentNode.remove()
          updateCounter()
        }
      }

      for (const img of shadowRoot.querySelectorAll('#iv-image-list li img')) {
        if (img.complete) {
          action(img)
        } else {
          img.addEventListener('load', action)
          img.addEventListener('error', action)
        }
      }
    }

    const liList = [...shadowRoot.querySelectorAll('#iv-image-list li')]
    const current = shadowRoot.querySelector('#iv-image-list li.current')
    const baseIndex = current ? liList.indexOf(current) : options.index || 0
    const base = current || liList[baseIndex]
    base.classList.add('current')

    const imageListNode = shadowRoot.querySelector('#iv-image-list')
    imageListNode.style.translate = `0 ${-baseIndex * 100}%`

    const counterTotal = shadowRoot.querySelector('#iv-counter-total')
    const counterCurrent = shadowRoot.querySelector('#iv-counter-current')
    updateCounter()

    let completeFlag = false
    base.firstChild.addEventListener('load', () => {
      if (options.sizeCheck) {
        const minSize = Math.min(base.firstChild.naturalWidth, base.firstChild.naturalHeight)
        options.minWidth = Math.min(minSize, options.minWidth)
        options.minHeight = Math.min(minSize, options.minHeight)
        options.sizeCheck = false
        fitImage(options)
      }
      shadowRoot.querySelector('#iv-info-width').value = base.firstChild.naturalWidth
      shadowRoot.querySelector('#iv-info-height').value = base.firstChild.naturalHeight
      if (!completeFlag) removeFailedImg()
      completeFlag = true
    })
    setTimeout(() => {
      if (!completeFlag) removeFailedImg()
      completeFlag = true
    }, 3000)
  }

  function fitImage(options, update = false) {
    if (options.sizeCheck) return

    const fitFunc = fitFuncDict.get(options.fitMode) || fitFuncDict.get('both')
    const action = img => {
      const [w, h] = fitFunc(img.naturalWidth, img.naturalHeight)
      img.width = w
      img.height = h
      img.style.transform = 'matrix(1,0,0,1,0,0)'
      img.classList.add('loaded')
    }
    const event = new CustomEvent('resetTransform')
    for (const li of shadowRoot.querySelectorAll(`#iv-image-list li${update ? ':not(.addedImageEvent)' : ''}`)) {
      const img = li.firstChild
      img.addEventListener('load', () => action(img))
      if (img.naturalWidth) action(img)
      li.dispatchEvent(event)
    }
  }

  function addFrameEvent(options) {
    const viewer = shadowRoot.querySelector('#image-viewer')
    function initKeydownHandler() {
      if (document.documentElement.classList.contains('has-image-viewer-listener')) return
      document.documentElement.classList.add('has-image-viewer-listener')
      window.addEventListener(
        'keydown',
        e => {
          if (!document.documentElement.classList.contains('has-image-viewer')) return
          for (const func of keydownHandlerList) {
            func(e)
          }
        },
        true
      )
    }
    function addFitButtonEvent() {
      const currFitBtn = shadowRoot.querySelector(`#iv-control-${options.fitMode}`)
      currFitBtn?.classList.add('on')
      const fitBtnList = shadowRoot.querySelectorAll('#iv-control-buttons button[data-fit]')
      for (const fitBtn of fitBtnList) {
        fitBtn.addEventListener('click', () => {
          for (const btn of fitBtnList) {
            btn.classList.remove('on')
          }
          fitBtn.classList.add('on')
          options.fitMode = fitBtn.getAttribute('data-fit')
          fitImage(options)
        })
      }
      window.addEventListener('resize', () => fitImage(options))
    }
    function addMoveToButtonEvent() {
      if (!options.closeButton) return

      async function moveTo() {
        const current = shadowRoot.querySelector('#iv-counter-current')
        const total = shadowRoot.querySelector('#iv-counter-total')
        const currIndex = Number(current.innerHTML) - 1
        const imageListLength = Number(total.innerHTML)
        closeImageViewer()

        const htmlTemp = document.documentElement.style.scrollBehavior
        const bodyTemp = document.body.style.scrollBehavior
        document.documentElement.style.scrollBehavior = 'auto'
        document.body.style.scrollBehavior = 'auto'

        const ratio = currIndex / imageListLength
        const totalHeight = document.body.scrollHeight || document.documentElement.scrollHeight
        const targetTop = totalHeight * ratio
        window.scrollTo(window.scrollX, targetTop)
        await new Promise(resolve => setTimeout(resolve, 100))

        const img = shadowRoot.querySelector('li.current img')
        let imgNode = searchImgNode(img)
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
        while (currentY !== window.scrollY) {
          currentY = window.scrollY
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
      if (!options.closeButton) return
      const closeButton = shadowRoot.querySelector('#iv-control-close')
      closeButton.classList.add('show')
      closeButton.addEventListener('click', closeImageViewer)
      closeButton.addEventListener('contextmenu', e => {
        e.preventDefault()
        chrome.runtime ? chrome.runtime.sendMessage('close_tab') : window.close()
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
      const openNewTab = chrome.runtime ? anchor => chrome.runtime.sendMessage({msg: 'open_tab', url: anchor.href}) : anchor => window.open(anchor.href, '_blank')
      const dispatchEvent = anchor => anchor.dispatchEvent(new MouseEvent('click', {button: 1, which: 2}))

      const action = taskFunc => {
        const img = shadowRoot.querySelector('li.current img')
        const imgNode = searchImgNode(img)
        if (!imgNode) return
        const anchor = searchImgAnchor(imgNode)
        if (!anchor) return
        taskFunc(anchor)
      }

      keydownHandlerList.push(e => {
        if (e.ctrlKey || e.altKey || e.getModifierState('AltGraph') || e.shiftKey) return
        if (e.key === 'Insert' || e.key === '0') {
          e.preventDefault()
          action(openNewTab)
        }
      })
      // call preventDefault to trigger auxclick event
      viewer.addEventListener('mousedown', e => {
        if (e.button === 1) e.preventDefault()
      })
      // browsers map middle click to opening a link in a new tab without switching
      // opening a link in auxclick event handler can do the same job (undocumented?)
      viewer.addEventListener('auxclick', e => {
        if (e.button === 1) action(dispatchEvent)
      })
    }
    function disableWebsiteDefaultEvent() {
      const disableList = [
        'click',
        'contextmenu',
        'dblclick',
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
    }
    function addSearchHotkeyEvent() {
      function checkKey(e, hotkey) {
        const keyList = hotkey.split('+').map(str => str.trim())
        const key = keyList[keyList.length - 1] === e.key.toUpperCase()
        const ctrl = keyList.includes('Ctrl') === e.ctrlKey
        const alt = keyList.includes('Alt') === e.altKey || e.getModifierState('AltGraph')
        const shift = keyList.includes('Shift') === e.shiftKey
        return key && ctrl && alt && shift
      }
      const openNewTab = chrome.runtime ? url => chrome.runtime.sendMessage({msg: 'open_tab', url: url}) : url => window.open(url, '_blank')

      if (!options.searchHotkey || options.searchHotkey.length < 5) return
      const hotkey = options.searchHotkey
      const googleUrl = String.raw`https://lens.google.com/uploadbyurl?url={imgSrc}`
      const yandexUrl = String.raw`https://yandex.com/images/search?family=yes&rpt=imageview&url={imgSrc}`
      const saucenaoUrl = String.raw`https://saucenao.com/search.php?db=999&url={imgSrc}`
      const ascii2dUrl = String.raw`https://ascii2d.net/search/url/{imgSrc}`
      const urlList = [googleUrl, yandexUrl, saucenaoUrl, ascii2dUrl]

      keydownHandlerList.push(e => {
        for (let i = urlList.length - 1; i >= 0; i--) {
          if (hotkey[i] === '' || !checkKey(e, hotkey[i])) continue

          e.preventDefault()
          const imgUrl = shadowRoot.querySelector('li.current img').src
          const queryUrl = urlList[i].replace('{imgSrc}', imgUrl)
          openNewTab(queryUrl)
          break
        }
      })

      keydownHandlerList.push(e => {
        if (!checkKey(e, hotkey[4])) return
        e.preventDefault()
        const imgUrl = shadowRoot.querySelector('li.current img').src
        for (let i = urlList.length - 1; i >= 0; i--) {
          const queryUrl = urlList[i].replace('{imgSrc}', imgUrl)
          openNewTab(queryUrl)
        }
      })

      const customHotkey = hotkey.slice(5)
      const customUrl = options.customUrl
      if (customHotkey.length !== customUrl.length) return
      keydownHandlerList.push(e => {
        for (let i = customHotkey.length - 1; i >= 0; i--) {
          if (customHotkey[i] === '' || !checkKey(e, customHotkey[i])) continue

          e.preventDefault()
          const imgUrl = shadowRoot.querySelector('li.current img').src
          const queryUrl = customUrl[i].replace('{imgSrc}', imgUrl)
          openNewTab(queryUrl)
          break
        }
      })
    }

    initKeydownHandler()
    addFitButtonEvent()
    addMoveToButtonEvent()
    addCloseButtonEvent()
    addMiddleClickKeyEvent()
    disableWebsiteDefaultEvent()
    addSearchHotkeyEvent()
  }

  function addImageEvent(options) {
    async function addTransformHandler(li) {
      const img = li.firstChild
      let zoomCount = 0
      let rotateCount = 0

      // zoom & rotate
      li.addEventListener('wheel', e => {
        e.preventDefault()
        let [scaleX, scaleY, rotate, moveX, moveY] = MtoV(img.style.transform)
        const mirror = Math.sign(scaleX) * Math.sign(scaleY)
        if (!e.altKey && !e.getModifierState('AltGraph')) {
          const newZoomCount = e.deltaY > 0 ? zoomCount - 1 : zoomCount + 1
          scaleX = Math.sign(scaleX) * options.zoomRatio ** newZoomCount
          scaleY = Math.sign(scaleY) * options.zoomRatio ** newZoomCount
          // recalculate displacement for zooming at the center of the viewpoint
          moveX = moveX * options.zoomRatio ** (newZoomCount - zoomCount)
          moveY = moveY * options.zoomRatio ** (newZoomCount - zoomCount)
          zoomCount = newZoomCount
        } else {
          // mirror === 1 ? (e.deltaY > 0 ? rotateCount++ : rotateCount--) : e.deltaY > 0 ? rotateCount-- : rotateCount++
          const deltaRotate = mirror * ((e.deltaY > 0) * 2 - 1)
          rotateCount += deltaRotate
          // recalculate displacement for rotation around the center of the viewpoint
          const radial = Math.sqrt(moveX ** 2 + moveY ** 2)
          const angle = (Math.atan2(moveY, moveX) * 180) / Math.PI
          const newAngle = angle + mirror * options.rotateDeg * deltaRotate
          const newRadian = (newAngle / 180) * Math.PI
          moveX = radial * Math.cos(newRadian)
          moveY = radial * Math.sin(newRadian)
        }
        // rotate value must be reset every time after updating the transform matrix
        rotate = (mirror * options.rotateDeg * rotateCount) % 360
        img.style.transform = VtoM(scaleX, scaleY, rotate, moveX, moveY)
      })

      // mirror-reflect
      li.addEventListener('click', e => {
        if (!e.altKey && !e.getModifierState('AltGraph')) return
        let [scaleX, scaleY, rotate, moveX, moveY] = MtoV(img.style.transform)
        const mirror = Math.sign(scaleX) * Math.sign(scaleY)
        rotate = (mirror * options.rotateDeg * rotateCount) % 360
        rotateCount *= -1
        img.style.transform = VtoM(-scaleX, scaleY, rotate, moveX, moveY)
      })

      // dragging
      let dragFlag = false
      let imagePos = {x: 0, y: 0}
      let startPos = {x: 0, y: 0}
      li.addEventListener('mousedown', e => {
        dragFlag = true
        const [moveX, moveY] = MtoV(img.style.transform).slice(-2)
        imagePos = {x: moveX, y: moveY}
        startPos = {x: e.clientX, y: e.clientY}
      })
      li.addEventListener('mousemove', e => {
        if (!dragFlag) return
        let [scaleX, scaleY, rotate, moveX, moveY] = MtoV(img.style.transform)
        moveX = imagePos.x + e.clientX - startPos.x
        moveY = imagePos.y + e.clientY - startPos.y
        const mirror = Math.sign(scaleX) * Math.sign(scaleY)
        rotate = (mirror * options.rotateDeg * rotateCount) % 360
        img.style.transform = VtoM(scaleX, scaleY, rotate, moveX, moveY)
      })
      li.addEventListener('mouseup', () => (dragFlag = false))

      // reset
      const reset = () => {
        zoomCount = 0
        rotateCount = 0
        img.style.transform = 'matrix(1,0,0,1,0,0)'
        imagePos = {x: 0, y: 0}
        startPos = {x: 0, y: 0}
      }
      li.addEventListener('dblclick', reset)
      // custom event
      li.addEventListener('resetTransform', reset)
    }

    for (const li of shadowRoot.querySelectorAll('#iv-image-list li:not(.addedImageEvent)')) {
      li.classList.add('addedImageEvent')
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
    let throttleTimestamp = Date.now()
    let debounceFlag = false

    function moveToNode(index) {
      current.innerHTML = index + 1
      imageListNode.style.translate = `0 ${-index * 100}%`
      imageListNode.querySelector('li.current')?.classList.remove('current')

      const relateListItem = imageListNode.querySelector(`li:nth-child(${index + 1})`)
      relateListItem.classList.add('current')

      const relateImage = relateListItem.querySelector('img')
      infoWidth.value = relateImage.naturalWidth
      infoHeight.value = relateImage.naturalHeight
    }

    function prevItem(repeat = false) {
      if (!repeat) {
        clearTimeout(debounceTimeout)
        debounceFlag = false
        throttleTimestamp = Date.now()
      }
      const currentIndex = Number(current.innerHTML) - 1
      const imageListLength = Number(total.innerHTML)
      const prevIndex = currentIndex === 0 ? imageListLength - 1 : currentIndex - 1

      if (!repeat) {
        moveToNode(prevIndex)
        return
      }

      if (prevIndex === imageListLength - 1) {
        if (!debounceFlag) {
          debounceTimeout = setTimeout(
            () => {
              const currentIndex = Number(current.innerHTML) - 1
              const imageListLength = Number(total.innerHTML)
              const prevIndex = currentIndex === 0 ? imageListLength - 1 : currentIndex - 1
              moveToNode(prevIndex)
              debounceFlag = false
            },
            Date.now() - lastUpdateTime > 5000 ? debouncePeriod : 5000
          )
        }
        debounceFlag = true
      } else if (Date.now() >= throttleTimestamp + throttlePeriod) {
        moveToNode(prevIndex)
        clearTimeout(debounceTimeout)
        debounceFlag = false
        throttleTimestamp = Date.now()
      }
    }

    function nextItem(repeat = false) {
      if (!repeat) {
        clearTimeout(debounceTimeout)
        debounceFlag = false
        throttleTimestamp = Date.now()
      }
      const currentIndex = Number(current.innerHTML) - 1
      const imageListLength = Number(total.innerHTML)
      const nextIndex = currentIndex >= imageListLength - 1 ? 0 : currentIndex + 1

      if (!repeat) {
        moveToNode(nextIndex)
        return
      }

      if (nextIndex === 0) {
        if (!debounceFlag) {
          debounceTimeout = setTimeout(
            () => {
              const currentIndex = Number(current.innerHTML) - 1
              const imageListLength = Number(total.innerHTML)
              const nextIndex = currentIndex >= imageListLength - 1 ? 0 : currentIndex + 1
              moveToNode(nextIndex)
              debounceFlag = false
            },
            Date.now() - lastUpdateTime > 5000 ? debouncePeriod : 5000
          )
        }
        debounceFlag = true
      } else if (Date.now() >= throttleTimestamp + throttlePeriod) {
        moveToNode(nextIndex)
        clearTimeout(debounceTimeout)
        debounceFlag = false
        throttleTimestamp = Date.now()
      }
    }

    // key event
    const normalNavigation = e => {
      if (e.ctrlKey || e.altKey || e.getModifierState('AltGraph') || e.shiftKey) return
      const left = e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'a'
      const right = e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 's' || e.key === 'd'
      if (left || right) {
        e.preventDefault()
        right ? nextItem(e.repeat) : prevItem(e.repeat)
      }
    }
    const fastNavigation = e => {
      if (!e.ctrlKey || e.altKey || e.getModifierState('AltGraph') || e.shiftKey) return
      const left = e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'a'
      const right = e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 's' || e.key === 'd'
      if (left || right) {
        e.preventDefault()
        const currIndex = Number(current.innerHTML) - 1
        const newIndex = right ? Math.min(currIndex + 10, Number(total.innerHTML) - 1) : Math.max(currIndex - 10, 0)
        moveToNode(newIndex)
      }
    }
    keydownHandlerList.push(normalNavigation)
    keydownHandlerList.push(fastNavigation)
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
    function preprocess() {
      for (let i = newList.length - 1; i >= 0; i--) {
        const data = newList[i]
        const url = typeof data === 'string' ? data : data[0]
        if (failedImageSet.has(url)) {
          newList.splice(i, 1)
        }
      }
    }
    function tryClear() {
      if (isCurrentListBad(newList)) {
        console.log('Clear bad image list')
        currentImageList.length = 0
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
      const imgList = shadowRoot.querySelectorAll('#iv-image-list li img')
      for (let i = 0; i < currentImageList.length; i++) {
        const data = currentImageList[i]
        if (typeof data !== 'string' || newUrlList.includes(data)) continue

        const rawUrl = getRawUrl(data)
        if (data !== rawUrl && newUrlList.includes(rawUrl)) {
          currentImageList[i] = rawUrl
          currentUrlList[i] = rawUrl
          imgList[i].src = rawUrl
          updated = true
        }
      }
    }
    function tryInsert() {
      const counterCurrent = shadowRoot.querySelector('#iv-counter-current')
      const currentIndex = counterCurrent.innerHTML - 1
      for (let i = 0; i < newList.length; i++) {
        const data = newList[i]
        const url = typeof data === 'string' ? data : data[0]
        const index = currentUrlList.indexOf(url)
        if (index !== -1) continue

        const node = buildImageNode(data, options)
        insertImageNode(node, i)
        updated = true
        if (i === 0 && currentIndex === 0) {
          console.log('First image changed')
          clearIndex = 0
        }
      }
    }
    function tryRemove() {
      const current = shadowRoot.querySelector('li.current img')
      const currentSrc = current.src
      for (const imgNode of shadowRoot.querySelectorAll('#iv-image-list li img')) {
        if (!newUrlList.includes(imgNode.src)) {
          imgNode.parentElement.remove()
          updated = true
        }
      }

      const rawUrl = getRawUrl(currentSrc)
      if (!shadowRoot.contains(current) || rawUrl === currentSrc) return
      for (const imgNode of shadowRoot.querySelectorAll('#iv-image-list li img')) {
        if (imgNode.src === rawUrl) {
          imgNode.parentElement.classList.add('current')
          break
        }
      }
    }

    preprocess()
    const cleared = tryClear()
    if (cleared) return

    const currentUrlList = []
    for (const data of currentImageList) {
      const url = typeof data === 'string' ? data : data[0]
      currentUrlList.push(url)
    }
    const newUrlList = []
    for (const data of newList) {
      const url = typeof data === 'string' ? data : data[0]
      newUrlList.push(url)
    }

    let updated = false
    tryUpdate()
    tryInsert()
    tryRemove()

    currentImageList = Array.from(newList)
    lastUpdateTime = Date.now()

    shadowRoot.querySelector('#iv-index').style.display = 'inline'
    shadowRoot.querySelector('#iv-counter-total').innerHTML = currentImageList.length
    if (updated) console.log('Image viewer updated')
  }

  //==========main function==========
  function ImageViewer(imageList, options) {
    if (arguments.length === 1) {
      const action = arguments[0]
      switch (action) {
        case 'get_image_list':
          return Array.from(currentImageList)
        case 'clear_image_list': {
          clearFlag = true
          const current = shadowRoot.querySelector('li.current img')
          const counterCurrent = shadowRoot.querySelector('#iv-counter-current')
          clearSrc = current.src
          clearIndex = counterCurrent.innerHTML - 1
          return
        }
        case 'close_image_viewer':
          closeImageViewer()
          return
        default:
          return
      }
    }

    if (imageList.length === 0) return

    if (!document.documentElement.classList.contains('has-image-viewer')) {
      buildApp()
      buildImageList(imageList, options)
      initImageList(options)
      fitImage(options)
      addFrameEvent(options)
      addImageEvent(options)
      addImageListEvent(options)
      console.log('Image viewer initialized')
    } else {
      updateImageList(imageList, options)
      initImageList(options)
      fitImage(options, true)
      addImageEvent(options)
    }
    restoreIndex(options)
  }

  return ImageViewer
})()
