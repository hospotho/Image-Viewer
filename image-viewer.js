const imageViewer = (function () {
  'use strict'

  const appName = '__crx__image-viewer'
  const imageListName = '__crx__image-list'
  let shadowRoot
  let currentImageList
  let removeTimeout
  let lastUpdateTime

  //==========utility==========
  function buildImageNode(data, options) {
    const li = document.createElement('li')
    const img = document.createElement('img')
    li.appendChild(img)

    img.alt = ''
    img.referrerPolicy = options.referrerPolicy ? 'no-referrer' : null
    img.crossorigin = options.cors ? 'anonymous' : null
    img.onload = () => {
      URL.revokeObjectURL(img.src)
    }

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
    const imageListNode = shadowRoot.querySelector(`.${appName} .${imageListName}`)
    const list = [...shadowRoot.querySelectorAll(`.${appName} .${imageListName} li`)]

    if (index === list.length) {
      imageListNode.appendChild(node)
    } else {
      imageListNode.insertBefore(node, list[index])
    }
  }

  function closeImageViewer() {
    document.documentElement.classList.remove('has-image-viewer')
    const viewer = document.querySelector('.__shadow__image-viewer')
    if (viewer) {
      viewer.addEventListener('transitionend', viewer.remove)
      viewer.style.transition = 'opacity 0.2s'
      viewer.style.opacity = '0'
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
    const match = str.match(/matrix\([-\d\.e, ]+\)/)
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

  function getRawUrl(src) {
    const argsRegex = /(.*?(?:png|jpeg|jpg|gif|bmp|tiff|webp)).*/i
    const argsMatch = !src.startsWith('data') && src.match(argsRegex)
    if (argsMatch) {
      const rawUrl = argsMatch[1]
      if (rawUrl !== src) return rawUrl
    }
    try {
      const url = new URL(src)
      const noSearch = url.origin + url.pathname
      if (noSearch !== src) return noSearch
    } catch (error) {}
    return src
  }
  function searchImgNode(img) {
    const iframeSrc = img.getAttribute('data-iframe-src')
    if (iframeSrc) {
      for (const iframe of document.getElementsByTagName('iframe')) {
        if (iframe.src === iframeSrc) {
          return iframe
        }
      }
    }

    const imgUrl = img.src
    for (const img of document.getElementsByTagName('img')) {
      if (imgUrl === img.currentSrc || imgUrl === getRawUrl(img.src)) {
        // check visibility by offsetParent
        if (img.offsetParent === null && img.style.position !== 'fixed') continue
        return img
      }
    }
    for (const video of document.getElementsByTagName('video')) {
      if (imgUrl === video.poster) {
        return video
      }
    }
    for (const node of document.querySelectorAll('*')) {
      const backgroundImage = window.getComputedStyle(node).backgroundImage
      if (backgroundImage === 'none') continue
      const bg = backgroundImage.split(', ')[0]
      if (bg !== 'none' && imgUrl === bg.substring(4, bg.length - 1).replace(/['"]/g, '')) {
        return node
      }
    }
    return null
  }
  function searchImgAnchor(imgNode) {
    let el = imgNode
    while (el.parentElement) {
      el = el.parentElement
      if (el.tagName.toLowerCase() === 'a') return el
    }
    return null
  }

  const fitFuncDict = {
    both: (imageWidth, imageHeight) => {
      const windowWidth = document.documentElement.clientWidth
      const windowHeight = document.compatMode === 'CSS1Compat' ? document.documentElement.clientHeight : document.body.clientHeight
      const windowRatio = windowWidth / windowHeight
      const imgRatio = imageWidth / imageHeight
      return imgRatio >= windowRatio ? [windowWidth, windowWidth / imgRatio] : [windowHeight * imgRatio, windowHeight]
    },
    width: (imageWidth, imageHeight) => {
      const windowWidth = document.documentElement.clientWidth
      const imgRatio = imageWidth / imageHeight
      return [windowWidth, windowWidth / imgRatio]
    },
    height: (imageWidth, imageHeight) => {
      const windowHeight = document.doctype ? document.documentElement.clientHeight : document.body.clientHeight
      const imgRatio = imageWidth / imageHeight
      return [windowHeight * imgRatio, windowHeight]
    },
    none: (imageWidth, imageHeight) => {
      return [imageWidth, imageHeight]
    }
  }

  //==========html&style==========
  const frame = () => {
    return `<ul class="${imageListName}"></ul>
    <nav class="${appName}-control">
      <div class="${appName}-relate">
        <ul>
          <li><button class="${appName}-control-prev">Previous</button></li>
          <li><button class="${appName}-control-next">Next</button></li>
        </ul>
        <p class="${appName}-relate-counter"><span class="${appName}-relate-counter-current">1</span>/<span class="${appName}-relate-counter-total">1</span></p>
      </div>
      <ul class="${appName}-control-buttons">
        <li><button data-fit="both" class="${appName}-control-button-both"></button></li>
        <li><button data-fit="width" class="${appName}-control-button-width"></button></li>
        <li><button data-fit="height" class="${appName}-control-button-height"></button></li>
        <li><button data-fit="none" class="${appName}-control-button-none"></button></li>
        <li><button class="${appName}-button-moveto"></button></li>
      </ul>
      <ul class="${appName}-info">
        <li>
          <span class="label"><span data-i18n="width">Width</span>: </span><input class="${appName}-info-width">
        </li>
        <li>
          <span class="label"><span data-i18n="height">Height</span>: </span><input class="${appName}-info-height">
        </li>
      </ul>
    </nav>
    <button class="${appName}-button-close">Close</button>`
  }

  const style = () => {
    return `* {
        user-select: none;
        -webkit-user-drag: none;
      }
      .__crx__image-viewer * {
        margin: 0;
        padding: 0;
      }
      .__crx__image-viewer {
        position: fixed;
        left: 0;
        top: 0;
        z-index: 2147483647;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8) !important;
      }
      .__crx__image-viewer,
      .__crx__image-viewer input {
        font-family: Verdana, Helvetica, Arial, sans-serif;
        color: #ddd;
        font-size: 1em;
      }
      .__crx__image-viewer .__crx__image-list {
        width: 100%;
        height: 100%;
        padding: 0;
        margin: 0;
        position: absolute;
        left: 0;
        top: 0;
        transition: 0s;
      }
      .__crx__image-viewer .__crx__image-list li {
        cursor: move;
        width: 100%;
        height: 100%;
        list-style: none;
        position: relative;
        overflow: hidden;
      }
      .__crx__image-viewer .__crx__image-list li img {
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
      .__crx__image-viewer .__crx__image-list li img.loaded {
        max-width: none;
        max-height: none;
      }
      .__crx__image-viewer .__crx__image-viewer-control {
        position: fixed;
        left: 0;
        bottom: 0;
        width: 100%;
        height: 60px;
        background: rgba(0, 0, 0, 0);
        border-top: 0px #333 solid;
      }
      .__crx__image-viewer .__crx__image-viewer-control * {
        visibility: hidden;
      }
      .__crx__image-viewer .__crx__image-viewer-control:hover,
      .__crx__image-viewer .__crx__image-viewer-control:hover * {
        background: rgba(0, 0, 0, 0.8);
        visibility: visible;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-info {
        position: absolute;
        right: 10px;
        top: -5px;
        margin-top: 5px;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-info li {
        list-style: none;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-info .label {
        display: inline-block;
        width: 70px;
        text-align: right;
        margin-right: 5px;
        font-family: Verdana, Helvetica, Arial, sans-serif;
        color: #ddd;
        font-size: 16px;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-info input {
        background: none;
        border: 1px transparent dashed;
        border-radius: 5px;
        width: 70px;
        text-align: center;
        padding: 0 5px;
        font-family: Verdana, Helvetica, Arial, sans-serif;
        color: #ddd;
        font-size: 16px;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-info input:hover {
        border-color: #aaa;
      }
      .__crx__image-viewer .__crx__image-viewer-button-close {
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
      .__crx__image-viewer .__crx__image-viewer-button-close.show {
        display: block;
      }
      .__crx__image-viewer .__crx__image-viewer-button-close:before,
      .__crx__image-viewer .__crx__image-viewer-button-close:after {
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
      .__crx__image-viewer .__crx__image-viewer-button-close:before {
        transform: rotate(-45deg);
      }
      .__crx__image-viewer .__crx__image-viewer-button-close:after {
        transform: rotate(45deg);
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-relate {
        position: absolute;
        left: 10px;
        top: 0;
        margin-top: 5px;
        display: none;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-relate .__crx__image-viewer-relate-counter,
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-relate .__crx__image-viewer-relate-counter span {
        display: inline-block;
        font-family: Verdana, Helvetica, Arial, sans-serif;
        color: #ddd;
        font-size: 16px;
        visibility: visible;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-relate ul {
        display: inline-block;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-relate li {
        list-style: none;
        display: inline-block;
        width: 50px;
        margin: 0 5px;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-relate li button {
        cursor: pointer;
        width: 50px;
        height: 50px;
        border: 0;
        white-space: nowrap;
        text-indent: 150%;
        overflow: hidden;
        position: relative;
        background: rgba(0, 0, 0, 0.5);
        border-radius: 5px;
        box-shadow: inset 0 0 2px #fff;
        background-size: cover;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-relate li button:hover {
        box-shadow: inset 0 0 10px #fff;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-relate li button:active,
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-relate li button.on {
        box-shadow: inset 0 0 20px #fff;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-relate li button:after {
        content: '';
        position: absolute;
        top: 50%;
        margin-top: -12px;
        display: block;
        width: 0px;
        height: 0px;
        border-style: solid;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-relate li .__crx__image-viewer-control-prev:after {
        left: 50%;
        margin-left: -10px;
        border-width: 12px 18px 12px 0;
        border-color: transparent #787878 transparent transparent;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-relate li .__crx__image-viewer-control-next:after {
        right: 50%;
        margin-right: -10px;
        border-width: 12px 0 12px 18px;
        border-color: transparent transparent transparent #787878;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-control-buttons {
        display: flex;
        justify-content: center;
        margin: 5px auto 0;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-control-buttons li {
        list-style: none;
        display: inline-block;
        width: 50px;
        margin: 0 5px;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-control-buttons li button {
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
        background-size: cover;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-control-buttons li button:after {
        content: attr(data-tooltip);
        position: absolute;
        top: -50px;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-control-buttons li button:hover {
        box-shadow: inset 0 0 10px #fff;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-control-buttons li button:active,
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-control-buttons li button.on {
        box-shadow: inset 0 0 20px #fff;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-control-buttons li .__crx__image-viewer-control-button-both {
        background: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAA2ZpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMy1jMDExIDY2LjE0NTY2MSwgMjAxMi8wMi8wNi0xNDo1NjoyNyAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iIHhtbG5zOnN0UmVmPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VSZWYjIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtcE1NOk9yaWdpbmFsRG9jdW1lbnRJRD0ieG1wLmRpZDpFMjlCMEFGMTRDQzZFMTExOEZFQUQ0QkNGMDJGMzg3NyIgeG1wTU06RG9jdW1lbnRJRD0ieG1wLmRpZDpCQ0YxQUQ0NEM2NTAxMUUxQjgzRUY4RjM0QUVGODRFQyIgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDpCQ0YxQUQ0M0M2NTAxMUUxQjgzRUY4RjM0QUVGODRFQyIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgQ1M2IChXaW5kb3dzKSI+IDx4bXBNTTpEZXJpdmVkRnJvbSBzdFJlZjppbnN0YW5jZUlEPSJ4bXAuaWlkOkUzOUIwQUYxNENDNkUxMTE4RkVBRDRCQ0YwMkYzODc3IiBzdFJlZjpkb2N1bWVudElEPSJ4bXAuZGlkOkUyOUIwQUYxNENDNkUxMTE4RkVBRDRCQ0YwMkYzODc3Ii8+IDwvcmRmOkRlc2NyaXB0aW9uPiA8L3JkZjpSREY+IDwveDp4bXBtZXRhPiA8P3hwYWNrZXQgZW5kPSJyIj8++nwS+AAABB1JREFUeNrsnUtoE0EcxicaRaFKQQ8+oHqoGlvwcfNoRVBP2ouIl9ZLDz4OVqkGi1ZaWInaiyIiHrxo9eDjpMWL4llRRG2LIthDLVghYqk1BOM37ERimmQ3uzObbPJ98DFtMrPJ/n/7n53N7uxGMpmMoKpH8xgCAqEIhEAoj4qGfQXi8XgERQLusSwrwwypvPbDJ1UZekXCPOxFdixCMQKvhb/AMWTJLDOkcjquYEitgbuZIZXLjhUoxuClOS//hNcjSyaZIcGrPw+G1BL4K7us4LNjM4pDJd7fQiDBahCe7/A+gQSUHXtR7HCo1oZ6+wjEPIwFKC66rJ5A/YUEYlZH4XUu68p6RzjsNZcdy1B8ghvLaJaEmzEM/s4M0a++MmEIVb+PGaI/OzaieCu8/RiahjchS0aYIfp0WXj/ZTqq2jNDAsicgl8e2RDhcQhFIARCEQiBUARCEQiBUARCIBSBEAhFIARCEQhFIARCEQiBUD4VZQj8KR6P+2pvWZaZDMEXa4Gf1CETuc4tVZMhgLAcxXm4q04zbje8E74Bn4OnKgJEXch8DO4V5V9RWItd/2H4IDwAX4FTge3UAaMdxXv4EmH8p0YVExmbduMZAhBbhT0ZZjtjX1LN8AP4ubAnor7WCgQgVqpU7PSSVWOjo3Ne2xCLaa1XTZ+bI7nhvoRvqa7dcf5jyUtJAWKxInwabuCG70vT8AXVw/wqNuyNFgEhr409oBbQxFhqUYPqZbrUBn4XzrjdqUuKdwjDiJpUbAfLGWV1qyHcOOOnXeMqtt2ugci76sBD+DOmdkbTjKOWfUiviulQoe7KcaeeN8qaYEx9aVWhUZarnXqBRnJBETfHIZ0dHRHTQ81svWITdrLfwdTn5m2spbZoM8chOWDkgtvUkXpCHQA5fulC0l3PbRuTn5sjOVu4B34YyE8nACM/qFXYNw5Lsjf6p6SKSasXGJ6BKCgpWE6mlBP0rwl7tmu9Kq1iIGMhY5LyuiDf50MAZQqWd0yQd+gZrkMYw2rdZQym/C5M2/kLQPmAYk8dAtG6zjynXmXiOXX/PYNghtSwCIRAKAIhEIpACIQiEAKhCIRAKAKhCIRAKAIhEIpACIQikHpWWJ6O8Fj4u7rjqWVZu5gh+nRCeL8QL63as8vSJfXsj+sem99E+3cEol99ovzriH/AZ7lTN5Ml8jlS/WU2G0C7bwRiTlfhjy7rfhb2HRU47DWYJfKq8h6X1eUD738TiHkoj1A8c6j2AvXu88AwOMlpYn8c3ueReoBZ8kbYt6so9v4rAgleZ8Tc6dry/9UhXqfwAkEWTAr71h+5SuD1CQKpnOR8vuzdJsZFiB4gWZNAkA2zKE5luzD8PxN2ILUwg+oevA2+XQPrEu5Hr9aieIKKQCgCIRDKq/4KMACWrCf3M5jnFgAAAABJRU5ErkJggg==);
        background-size: cover;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-control-buttons li .__crx__image-viewer-control-button-width {
        background: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAA2ZpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMy1jMDExIDY2LjE0NTY2MSwgMjAxMi8wMi8wNi0xNDo1NjoyNyAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iIHhtbG5zOnN0UmVmPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VSZWYjIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtcE1NOk9yaWdpbmFsRG9jdW1lbnRJRD0ieG1wLmRpZDpFMjlCMEFGMTRDQzZFMTExOEZFQUQ0QkNGMDJGMzg3NyIgeG1wTU06RG9jdW1lbnRJRD0ieG1wLmRpZDpDMUY5QUJENEM2NTAxMUUxOUIyQ0IyMkFFREYxRUMyRCIgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDpDMUY5QUJEM0M2NTAxMUUxOUIyQ0IyMkFFREYxRUMyRCIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgQ1M2IChXaW5kb3dzKSI+IDx4bXBNTTpEZXJpdmVkRnJvbSBzdFJlZjppbnN0YW5jZUlEPSJ4bXAuaWlkOkUzOUIwQUYxNENDNkUxMTE4RkVBRDRCQ0YwMkYzODc3IiBzdFJlZjpkb2N1bWVudElEPSJ4bXAuZGlkOkUyOUIwQUYxNENDNkUxMTE4RkVBRDRCQ0YwMkYzODc3Ii8+IDwvcmRmOkRlc2NyaXB0aW9uPiA8L3JkZjpSREY+IDwveDp4bXBtZXRhPiA8P3hwYWNrZXQgZW5kPSJyIj8++tXJrAAAAnNJREFUeNrsnM8rBGEch3ckpfbg4MLBiWwc5D9wcODoJhdOeyCXTbKlpNRKuCgHJyecOHL0BygnWuXkwGUPe1BqU+Pz1jeF/TG7M8tknqc+vZN2h/k+768xNZ7v+ymIDx2UACGAEIQAQhACCEEIIAQhgBBACEIAIQgBhCAEEIIQQAggBCGAEIQAQhACCEEIIAQQghBACEIAIQgBhCAEEAIIiTedlCAc+Xw+1PcLhUJ7Roj+sBHlMoFO3DWPxGaESEKvmk0lm9ARN6VMKkfKhlL6EyES0aVmWVlXepj6U4vKnLKlHCiVX1vUJWNGzZ2yi4wv9FhNXG1m2j5CJGJczb4yQe3rMqicK9dKTrmNVIhE9NlQXGhlVD0Uiz9+NpzJ/IvPNcB13Bvl2Kb2l0Zf8Oq9nkkius3wmpKm44fiVdm2Geat1ra3s4YIT82snWCAWkZC2maZrHXwM8UPuqg7iyfIaAsDVtv9ZnZZOdvCPVG/yHmy2uYCC9G85iunOszYYvRKHSNZQ9atpqfVpquGi/q3XdYzNQ1Ff7VdVqBFvcqX3Im8IPchC/Pz3n/d4lb7nGpSr0c3fR/itfJWUrtT37EboO/yvCR1+xpCHpVV5SJAZw//rxOdxP2iUWVFKTMbfVK2mowGkdHMLiuIlIqyp8Mh5VB5T7CId6uBq4WrSaXVE4V+HiIpJWVJh2PKVQJlXNm1uxqUwp4ssucXknKvZjqBQiK9Zp6pxwyPd7/HC0YIQgAhCAGEIAQQghBACEIAIYAQhABCEAIIQQggBCGAEEAIQgAhCAGEIAQQghBACCAEIYAQhABCEAIIQQggBBAScz4EGADyS6Iw76d4WwAAAABJRU5ErkJggg==);
        background-size: cover;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-control-buttons li .__crx__image-viewer-control-button-height {
        background: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAA2ZpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMy1jMDExIDY2LjE0NTY2MSwgMjAxMi8wMi8wNi0xNDo1NjoyNyAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iIHhtbG5zOnN0UmVmPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VSZWYjIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtcE1NOk9yaWdpbmFsRG9jdW1lbnRJRD0ieG1wLmRpZDpFMjlCMEFGMTRDQzZFMTExOEZFQUQ0QkNGMDJGMzg3NyIgeG1wTU06RG9jdW1lbnRJRD0ieG1wLmRpZDpCOTg0RTgyNEM2NTAxMUUxQTRGQ0VBQ0ZFNDI0NzUwNSIgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDpCOTg0RTgyM0M2NTAxMUUxQTRGQ0VBQ0ZFNDI0NzUwNSIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgQ1M2IChXaW5kb3dzKSI+IDx4bXBNTTpEZXJpdmVkRnJvbSBzdFJlZjppbnN0YW5jZUlEPSJ4bXAuaWlkOkUzOUIwQUYxNENDNkUxMTE4RkVBRDRCQ0YwMkYzODc3IiBzdFJlZjpkb2N1bWVudElEPSJ4bXAuZGlkOkUyOUIwQUYxNENDNkUxMTE4RkVBRDRCQ0YwMkYzODc3Ii8+IDwvcmRmOkRlc2NyaXB0aW9uPiA8L3JkZjpSREY+IDwveDp4bXBtZXRhPiA8P3hwYWNrZXQgZW5kPSJyIj8+0DCtRAAAAndJREFUeNrsncFLFFEcx9/mBl0UoUvQIQ8aCVIdu8V2CU968u45L1YoixALBhMLdalDhw5ePPQPdOjQoXsgokgUgh5KECFRREWcvo99QSyxOzPNvPEtnw/8+O3OvCeuH76zs+vhV4nj2MDF4RJ/AoQAQhACGamG/gLq9XpFramai6IoJiHlM6V66nrwVEK+7VU6rqhtqIZUW6pbSskxCSmPWSfDckP1mISUl45ral9VA38dPlDdVEp2SIh/FttkWPpVP7lk+U/HHbXpDufvIsQvr1R9Xc4jxFM6JtQedFlW07pJ3tSLl3FZbV01kmD5N9WY3uBPSUhxzCSUYdy6RySkuHRcVfuuGkyx7ZdqWCnZIyH500gpw7j1DRKSfzpG1VZNti9Dz1S3lZINEpIfL032b6arbj8J8ZCcf/7ySkOFzyGAEIQAQhACCAGEIAQQghBACEIAIQgBhABCEAIIQQggBCGAEIQAQgAhCAGEIAQQghBACEIAIYAQhABCEAIIQQggBCGAEIQAQgAhCAGEIAQQghBACEIAIYAQhABCEAIIQQh4JJTpCB/Uxv/jR3yMoughCcmPJ6Y1diILZ24/l6y8cLM/3mbc/k771xCSPw3TGmGUhn3VM97Ui0mJnSO1mHLbc+3bRUhxvDGtcXhJ2FS95ra32JTYmYRzCZfbgfcn3Pb6uQ3+pFbrsOSzZNzng6E/7Nz08y7n+aTu8dK1orbU4fwXhPhnQXXYdsw+vx7wawpXiFKwo/ai7XBTx38gpDzswMht93jbBDRAsieFKA3HavN/LmF6fhS6kKoJn/eqe6rlHngtYY9e7UX4BxVCACEIgaz8FmAAavyUc1I71hUAAAAASUVORK5CYII=);
        background-size: cover;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-control-buttons li .__crx__image-viewer-control-button-none {
        background: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAA2ZpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMy1jMDExIDY2LjE0NTY2MSwgMjAxMi8wMi8wNi0xNDo1NjoyNyAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iIHhtbG5zOnN0UmVmPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VSZWYjIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtcE1NOk9yaWdpbmFsRG9jdW1lbnRJRD0ieG1wLmRpZDpFMjlCMEFGMTRDQzZFMTExOEZFQUQ0QkNGMDJGMzg3NyIgeG1wTU06RG9jdW1lbnRJRD0ieG1wLmRpZDpCNTE3QTJGNEM2NTAxMUUxOTdBNjg0RjY1RThFQ0QwMiIgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDpCNTE3QTJGM0M2NTAxMUUxOTdBNjg0RjY1RThFQ0QwMiIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgQ1M2IChXaW5kb3dzKSI+IDx4bXBNTTpEZXJpdmVkRnJvbSBzdFJlZjppbnN0YW5jZUlEPSJ4bXAuaWlkOkUzOUIwQUYxNENDNkUxMTE4RkVBRDRCQ0YwMkYzODc3IiBzdFJlZjpkb2N1bWVudElEPSJ4bXAuZGlkOkUyOUIwQUYxNENDNkUxMTE4RkVBRDRCQ0YwMkYzODc3Ii8+IDwvcmRmOkRlc2NyaXB0aW9uPiA8L3JkZjpSREY+IDwveDp4bXBtZXRhPiA8P3hwYWNrZXQgZW5kPSJyIj8+EIJY5QAAASxJREFUeNrs3UEOgjAQQFFrvHRP0GMPrIkmQKG25f2lRqO80IEIMUXES/30tgmACAgQAQEiIEAEBIiACAgQAQEiIEAEBIiACAgQAQEiIEDUrM/RF+Sca689TR1uh6rvVEpJ9hBLloAA0XBDfTvA1iF/y6Bs3N6hHPYQS5aACAgQAXnEYW/HxYnDWHvITRAx8DnQVCDxz5M4IIa6gAAZunTyOSCNUYY97J3lPCRN8j3MECACAkRAgAgIEAEBIiACAkRAgAjI9M3yA9X2kh8XynWE8euxIUpH/2Hngtuid32uCow73qe6vbdOmyGWLAEB0m4GXjA/xh7qX4b8ow9712HdF4gsWUAEBIiACAgQAQEiIEAEBIiACAgQAQEiIEAEBIiACAgQAQGiS1oEGACl7SnD1JcJ0wAAAABJRU5ErkJggg==);
        background-size: cover;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-control-buttons li .__crx__image-viewer-button-moveto {
        background: url(data:image/png;base64,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);
        background-size: cover;
      }`
  }

  //==========function define==========
  function buildApp() {
    //==========build frame==========
    document.documentElement.classList.add('has-image-viewer')

    const shadowHolder = document.createElement('div')
    shadowHolder.style.all = 'revert'
    shadowHolder.classList.add('__shadow__image-viewer')
    shadowRoot = shadowHolder.attachShadow({mode: 'closed'})
    // shadowRoot = shadowHolder.attachShadow({mode: 'open'})
    document.body.appendChild(shadowHolder)

    const stylesheet = document.createElement('style')
    stylesheet.innerHTML = style()
    const viewer = document.createElement('div')
    viewer.classList.add(appName)
    viewer.tabIndex = 0
    viewer.innerHTML = frame()

    shadowRoot.append(stylesheet)
    shadowRoot.append(viewer)
    viewer.focus()

    try {
      for (const node of shadowRoot.querySelectorAll(`.${appName} [data-i18n]`)) {
        const msg = chrome.i18n.getMessage(node.getAttribute('data-i18n'))
        if (msg) {
          node.innerHTML = msg
          if (node.value !== '') node.value = msg
        }
      }
    } catch (e) {}
  }

  function buildImageList(imageList, options) {
    const _imageList = shadowRoot.querySelector(`.${appName} .${imageListName}`)
    let first = buildImageNode(imageList[0], options)
    _imageList.appendChild(first)
    currentImageList = imageList
    lastUpdateTime = Date.now()

    if (imageList.length === 1) return
    shadowRoot.querySelector(`.${appName}-relate`).style.display = 'inline'
    shadowRoot.querySelector(`.${appName}-relate-counter-total`).innerHTML = imageList.length
    for (let i = 1; i < imageList.length; i++) {
      const li = buildImageNode(imageList[i], options)
      _imageList.appendChild(li)
    }
  }

  function initImageList(options) {
    function updateCounter() {
      const list = [...shadowRoot.querySelectorAll(`.${appName} .${imageListName} li`)]
      const length = list.length
      const current = shadowRoot.querySelector('li.current') || shadowRoot.querySelector(`.${appName} .${imageListName} li`)
      if (!shadowRoot.querySelector('li.current') && current) {
        // must in action-page mode
        current.classList.add('current')
        shadowRoot.querySelector(`.${appName}-info-width`).value = current.firstChild.naturalWidth
        shadowRoot.querySelector(`.${appName}-info-height`).value = current.firstChild.naturalHeight
      }
      const currIndex = list.indexOf(current)
      counterTotal.innerHTML = length
      counterCurrent.innerHTML = currIndex + 1
      imageListNode.style.top = `${-currIndex * 100}%`
      if (length === 0) closeImageViewer()
    }
    function removeFailedImg() {
      const action = e => {
        const img = e?.target ?? e
        if (img.naturalWidth < options.minWidth || img.naturalHeight < options.minHeight) {
          img.parentNode.remove()
          updateCounter()
        }
      }

      for (const img of shadowRoot.querySelectorAll(`.${appName} .${imageListName} li img`)) {
        if (img.complete) {
          action(img)
        } else {
          img.addEventListener('load', action)
          img.addEventListener('error', action)
        }
      }

      if (removeTimeout) clearTimeout(removeTimeout)
      removeTimeout = setTimeout(() => {
        for (const img of shadowRoot.querySelectorAll(`.${appName} .${imageListName} li img`)) {
          if (!img.complete) img.parentNode.remove()
        }
        updateCounter()
      }, 5000 + 500 * parseInt(counterTotal.innerHTML))
    }

    const liList = [...shadowRoot.querySelectorAll(`.${appName} .${imageListName} li`)]
    const current = shadowRoot.querySelector(`.${appName} .${imageListName} li.current`)
    const baseIndex = !!current ? liList.indexOf(current) : options.index || 0
    const base = current || liList[baseIndex]
    base.classList.add('current')

    const imageListNode = shadowRoot.querySelector(`.${appName} .${imageListName}`)
    imageListNode.style.top = `${-baseIndex * 100}%`

    const counterTotal = shadowRoot.querySelector(`.${appName}-relate-counter-total`)
    const counterCurrent = shadowRoot.querySelector(`.${appName}-relate-counter-current`)
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
      shadowRoot.querySelector(`.${appName}-info-width`).value = base.firstChild.naturalWidth
      shadowRoot.querySelector(`.${appName}-info-height`).value = base.firstChild.naturalHeight
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

    const fitFunc = fitFuncDict[options.fitMode] || fitFuncDict.both
    const action = img => {
      const [w, h] = fitFunc(img.naturalWidth, img.naturalHeight)
      img.width = w
      img.height = h
      img.style.transform = 'matrix(1,0,0,1,0,0)'
      img.classList.add('loaded')
    }
    const event = new CustomEvent('resetTransform')
    for (const li of shadowRoot.querySelectorAll(`.${appName} .${imageListName} li${update ? ':not(.addedImageEvent)' : ''}`)) {
      const img = li.firstChild
      img.addEventListener('load', () => action(img))
      if (img.naturalWidth) action(img)
      li.dispatchEvent(event)
    }
  }

  function addFrameEvent(options) {
    const viewer = shadowRoot.querySelector(`.${appName}`)
    function addFitButtonEvent() {
      const currFitBtn = shadowRoot.querySelector(`.${appName}-control-button-${options.fitMode}`)
      currFitBtn?.classList.add('on')
      for (const fitBtn of shadowRoot.querySelectorAll(`.${appName}-control-buttons button[data-fit]`)) {
        fitBtn.addEventListener('click', () => {
          shadowRoot.querySelectorAll(`.${appName}-control-buttons button`).forEach(btn => btn.classList.remove('on'))
          fitBtn.classList.add('on')
          const newOptions = options
          newOptions.fitMode = fitBtn.getAttribute('data-fit')
          fitImage(newOptions)
        })
      }
    }
    function addMoveToButtonEvent() {
      if (!options.closeButton) return

      const current = shadowRoot.querySelector(`.${appName}-relate-counter-current`)
      const total = shadowRoot.querySelector(`.${appName}-relate-counter-total`)

      const index = options.index || 0
      const img = shadowRoot.querySelector('.current img')
      const imgNode = searchImgNode(img)
      const startTop = imgNode ? imgNode.getBoundingClientRect().top : 0

      async function moveTo() {
        const img = shadowRoot.querySelector('.current img')
        let imgNode = searchImgNode(img)
        closeImageViewer()
        if (imgNode === null) {
          await new Promise(resolve => {
            const currIndex = Number(current.innerHTML) - 1
            const imageListLength = Number(total.innerHTML)
            const ratio = currIndex / (imageListLength - index)

            const totalHeight = document.body.scrollHeight
            const targetTop = (totalHeight - startTop) * ratio + startTop

            let timeout
            const newNodeObserver = new MutationObserver(() => {
              clearTimeout(timeout)
              imgNode = searchImgNode(img)
              if (imgNode !== null) {
                newNodeObserver.disconnect()
                resolve()
                return
              }
              timeout = setTimeout(() => {
                newNodeObserver.disconnect()
                imgNode = searchImgNode(img)
                resolve()
              }, 200)
            })
            newNodeObserver.observe(document.documentElement, {childList: true, subtree: true})
            window.scrollTo(window.scrollX, targetTop)
          })
          if (imgNode === null) {
            console.log('Image node not found')
            return
          }
        }
        console.log('Move to image node')
        imgNode.scrollIntoView({block: 'center'})
        const temp = imgNode.style.border
        imgNode.style.border = '5px solid red'
        setTimeout(() => (imgNode.style.border = temp), 1000)
      }
      shadowRoot.querySelector(`.${appName}-button-moveto`).addEventListener('click', moveTo)
      viewer.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault()
          moveTo()
        }
      })
    }
    function addCloseButtonEvent() {
      if (!options.closeButton) return
      const closeButton = shadowRoot.querySelector('.' + appName + ' .' + appName + '-button-close')
      closeButton.classList.add('show')
      closeButton.addEventListener('click', closeImageViewer)
      closeButton.addEventListener('contextmenu', e => {
        e.preventDefault()
        chrome ? chrome.runtime.sendMessage('close_tab') : window.close()
      })
      viewer.addEventListener('keydown', e => {
        if (e.key === 'Escape' || e.key === '"NumpadAdd"') {
          e.preventDefault()
          closeImageViewer()
        }
      })
    }
    function addMiddleClickKeyEvent() {
      const openNewTab = chrome ? url => chrome.runtime.sendMessage({msg: 'open_tab', url: url}) : url => window.open(url, '_blank')
      viewer.addEventListener('keydown', e => {
        if (e.key === 'Insert' || e.key === '0') {
          e.preventDefault()
          const img = shadowRoot.querySelector('.current img')
          const imgNode = searchImgNode(img)
          if (!imgNode) return
          const anchor = searchImgAnchor(imgNode)
          if (!anchor) return
          openNewTab(anchor.href)
        }
      })
    }
    function disableWebsiteDefaultEvent() {
      viewer.addEventListener('keydown', e => e.stopPropagation())
      viewer.addEventListener('keyup', e => e.stopPropagation())
      viewer.addEventListener('keypress', e => e.stopPropagation())
      viewer.addEventListener('contextmenu', e => e.stopPropagation())
      viewer.addEventListener('wheel', e => e.stopPropagation())
      viewer.addEventListener('mousedown', e => {
        if (e.button == 1) {
          e.preventDefault()
          return false
        }
      })
    }
    function addSearchHotkeyEvent() {
      function checkKey(e, hotkey) {
        const keyList = hotkey.split('+').map(str => str.trim())
        const key = keyList[keyList.length - 1] === e.key.toUpperCase()
        const ctrl = keyList.includes('Ctrl') === e.ctrlKey
        const alt = keyList.includes('Alt') === e.altKey
        const shift = keyList.includes('Shift') === e.shiftKey
        return key && ctrl && alt && shift
      }
      const openNewTab = chrome ? url => chrome.runtime.sendMessage({msg: 'open_tab', url: url}) : url => window.open(url, '_blank')

      if (!options.hotkey || options.hotkey.length < 5) return
      const hotkey = options.hotkey
      const googleUrl = String.raw`https://lens.google.com/uploadbyurl?url={imgSrc}`
      const yandexUrl = String.raw`https://yandex.com/images/search?family=yes&rpt=imageview&url={imgSrc}`
      const saucenaoUrl = String.raw`https://saucenao.com/search.php?db=999&url={imgSrc}`
      const ascii2dUrl = String.raw`https://ascii2d.net/search/url/{imgSrc}`
      const urlList = [googleUrl, yandexUrl, saucenaoUrl, ascii2dUrl]

      viewer.addEventListener('keydown', e => {
        for (let i = urlList.length - 1; i >= 0; i--) {
          if (hotkey[i] === '' || !checkKey(e, hotkey[i])) continue

          e.preventDefault()
          const imgUrl = shadowRoot.querySelector('.current img').src
          const queryUrl = urlList[i].replace('{imgSrc}', imgUrl)
          openNewTab(queryUrl)
          break
        }
      })

      viewer.addEventListener('keydown', e => {
        if (!checkKey(e, hotkey[4])) return
        e.preventDefault()
        const imgUrl = shadowRoot.querySelector('.current img').src
        for (let i = urlList.length - 1; i >= 0; i--) {
          const queryUrl = urlList[i].replace('{imgSrc}', imgUrl)
          openNewTab(queryUrl)
        }
      })

      const customHotkey = hotkey.slice(5)
      const customUrl = options.customUrl
      if (customHotkey.length !== customUrl.length) return
      viewer.addEventListener('keydown', e => {
        for (let i = customHotkey.length - 1; i >= 0; i--) {
          if (customHotkey[i] === '' || !checkKey(e, customHotkey[i])) continue

          e.preventDefault()
          const imgUrl = shadowRoot.querySelector('.current img').src
          const queryUrl = customUrl[i].replace('{imgSrc}', imgUrl)
          openNewTab(queryUrl)
          break
        }
      })
    }

    addFitButtonEvent()
    addMoveToButtonEvent()
    addCloseButtonEvent()
    addMiddleClickKeyEvent()
    disableWebsiteDefaultEvent()
    addSearchHotkeyEvent()
  }

  function addImageEvent(options) {
    function addTransformHandler(li) {
      const img = li.firstChild
      let zoomCount = 0
      let rotateCount = 0
      // zoom & rotate
      li.addEventListener('wheel', e => {
        e.preventDefault()
        let [scaleX, scaleY, rotate, moveX, moveY] = MtoV(img.style.transform)
        const mirror = Math.sign(scaleX) * Math.sign(scaleY)
        if (!e.altKey) {
          e.deltaY > 0 ? zoomCount-- : zoomCount++
          scaleX = Math.sign(scaleX) * options.zoomRatio ** zoomCount
          scaleY = Math.sign(scaleY) * options.zoomRatio ** zoomCount
        } else {
          // mirror === 1 ? (e.deltaY > 0 ? rotateCount++ : rotateCount--) : e.deltaY > 0 ? rotateCount-- : rotateCount++
          rotateCount += mirror * ((e.deltaY > 0) * 2 - 1)
        }
        rotate = (mirror * options.rotateDeg * rotateCount) % 360
        img.style.transform = VtoM(scaleX, scaleY, rotate, moveX, moveY)
      })
      // mirror-reflect
      li.addEventListener('click', e => {
        if (!e.altKey) return
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
        startPos = {x: e.clientX - imagePos.x, y: e.clientY - imagePos.y}
      })
      li.addEventListener('mousemove', e => {
        if (!dragFlag) return
        let [scaleX, scaleY, rotate, moveX, moveY] = MtoV(img.style.transform)
        rotate = options.rotateDeg * rotateCount
        moveX = e.clientX - startPos.x
        moveY = e.clientY - startPos.y
        img.style.transform = VtoM(scaleX, scaleY, rotate, moveX, moveY)
      })
      li.addEventListener('mouseup', e => {
        dragFlag = false
        imagePos = {x: e.clientX - startPos.x, y: e.clientY - startPos.y}
      })

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
    function addMiddleClickHandler(li) {
      const imgNode = searchImgNode(li.firstChild)
      if (!imgNode) return
      const anchor = searchImgAnchor(imgNode)
      if (!anchor) return

      li.addEventListener('auxclick', e => {
        if (e.button === 1) {
          anchor.dispatchEvent(new MouseEvent('click', {button: 1, which: 2}))
        }
      })
    }

    // resize
    window.addEventListener('resize', e => {
      fitImage(options)
    })

    for (const li of shadowRoot.querySelectorAll(`.${appName} .${imageListName} li:not(.addedImageEvent)`)) {
      li.classList.add('addedImageEvent')
      addTransformHandler(li)
      addMiddleClickHandler(li)
    }
  }

  function addImageListEvent(options) {
    const imageListNode = shadowRoot.querySelector(`.${appName} .${imageListName}`)
    const infoWidth = shadowRoot.querySelector(`.${appName}-info-width`)
    const infoHeight = shadowRoot.querySelector(`.${appName}-info-height`)
    const current = shadowRoot.querySelector(`.${appName}-relate-counter-current`)
    const total = shadowRoot.querySelector(`.${appName}-relate-counter-total`)

    const debouncePeriod = options.debouncePeriod ?? 1500
    const throttlePeriod = options.throttlePeriod ?? 80

    let debounceTimeout
    let throttleTimestamp = Date.now()
    let debounceFlag = false

    function moveToNode(index) {
      current.innerHTML = index + 1
      imageListNode.style.top = `${-index * 100}%`
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
    shadowRoot.querySelector(`.${appName}`).addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        nextItem(e.repeat)
        return
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        prevItem(e.repeat)
        return
      }
    })
    // arrow button
    shadowRoot.querySelector(`.${appName}-relate .${appName}-control-prev`).addEventListener('click', prevItem)
    shadowRoot.querySelector(`.${appName}-relate .${appName}-control-next`).addEventListener('click', nextItem)
    // control bar
    shadowRoot.querySelector(`.${appName}-control`).addEventListener('wheel', e => {
      e.preventDefault()
      e.deltaY > 0 ? nextItem() : prevItem()
    })
    // close button
    shadowRoot.querySelector(`.${appName} .${appName}-button-close`).addEventListener('wheel', e => {
      e.preventDefault()
      e.deltaY > 0 ? nextItem() : prevItem()
    })
  }

  function updateImageList(newList, options) {
    const newIndex = newList.map(data => {
      if (typeof data === 'string') {
        return currentImageList.indexOf(data)
      }
      for (let i = 0; i < currentImageList.length; i++) {
        if (currentImageList[i]?.[0] === data[0]) return i
      }
      return -1
    })

    for (let i = 0; i < newList.length; i++) {
      if (newIndex[i] === -1) {
        const node = buildImageNode(newList[i], options)
        insertImageNode(node, i)
      }
    }

    const current = shadowRoot.querySelector('li.current img')
    const currentSrc = current.src
    if (newList.indexOf(currentSrc) === -1) {
      current.parentElement.remove()
      const rawUrl = getRawUrl(currentSrc)
      for (const imgNode of shadowRoot.querySelectorAll(`.${appName} .${imageListName} li img`)) {
        if (imgNode.src === rawUrl) {
          imgNode.parentElement.classList.add('current')
          break
        }
      }
    }

    for (const imgNode of shadowRoot.querySelectorAll(`.${appName} .${imageListName} li img`)) {
      if (newList.indexOf(imgNode.src) === -1) imgNode.parentElement.remove()
    }

    currentImageList = newList
    lastUpdateTime = Date.now()

    shadowRoot.querySelector(`.${appName}-relate`).style.display = 'inline'
    shadowRoot.querySelector(`.${appName}-relate-counter-total`).innerHTML = currentImageList.length
  }

  //==========main function==========
  function imageViewer(imageList, options) {
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
      console.log('Image viewer updated')
    }
  }

  return imageViewer
})()
