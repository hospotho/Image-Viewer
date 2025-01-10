window.ImageViewerUtils = (function () {
  'use strict'

  const safeSendMessage = function (...args) {
    if (chrome.runtime?.id) {
      return chrome.runtime.sendMessage(...args)
    }
  }

  // parallel fetch
  const semaphore = (() => {
    let activeCount = 0
    const maxConcurrent = 32
    const queue = []
    return {
      acquire: function () {
        let executed = false
        const release = () => {
          if (executed) return
          executed = true
          activeCount--
          const grantAccess = queue.shift()
          if (grantAccess) grantAccess()
        }

        if (activeCount < maxConcurrent) {
          activeCount++
          return release
        }
        const {promise, resolve} = Promise.withResolvers()
        const grantAccess = () => {
          activeCount++
          resolve(release)
        }
        queue.push(grantAccess)
        return promise
      }
    }
  })()

  // attr unlazy
  const passList = new Set(['class', 'style', 'src', 'srcset', 'alt', 'title', 'loading', 'crossorigin', 'width', 'height', 'max-width', 'max-height', 'sizes', 'onerror', 'data-error'])
  const urlRegex = /(?:https?:\/)?\/\S+/g
  const protocol = location.protocol
  const origin = location.origin + '/'

  // image cache
  const pseudoImageDataList = []
  const badImageSet = new Set(['', 'about:blank'])
  const corsHostSet = new Set()
  const srcBitSizeMap = new Map()
  const srcRealSizeMap = new Map()

  // unlazy state
  let disableImageUnlazy = false
  let unlazyFlag = false
  let lastUnlazyTask = null
  let lastHref = ''

  // scroll state
  let enableAutoScroll = false
  let scrollUnlazyFlag = false
  let autoScrollFlag = false
  let scrollRelease = () => {}

  // init function hotkey
  window.addEventListener(
    'keydown',
    e => {
      if (!isImageViewerExist()) return
      // enable auto scroll
      if (checkKey(e, window.ImageViewerOption.functionHotkey[0])) {
        e.preventDefault()
        if (!enableAutoScroll) {
          console.log('Enable auto scroll')
          enableAutoScroll = true
        } else {
          console.log('Disable auto scroll')
          enableAutoScroll = false
        }
        if (unlazyFlag) autoScroll()
      }
      // download images
      if (checkKey(e, window.ImageViewerOption.functionHotkey[1])) {
        e.preventDefault()
        safeSendMessage('download_images')
      }
    },
    true
  )

  // init observer for unlazy image being modify
  const unlazyObserver = new MutationObserver(mutationsList => {
    const updatedSet = new Set()
    const modifiedSet = new Set()
    for (const mutation of mutationsList) {
      const element = mutation.target
      if (element.hasAttribute('iv-observing')) {
        updatedSet.add(element)
        continue
      }
      if (element.hasAttribute('iv-image') && !element.hasAttribute('iv-checking')) {
        modifiedSet.add(element)
      }
    }
    for (const img of updatedSet) {
      img.removeAttribute('iv-observing')
    }
    for (const img of modifiedSet) {
      img.setAttribute('iv-observing', '')
      setTimeout(async () => {
        while (!img.complete) {
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        const attrList = getUnlazyAttrList(img)
        if (attrList.length === 0) return
        checkImageAttr(img, attrList)
      }, 100)
    }
  })
  unlazyObserver.observe(document.body, {attributes: true, subtree: true, attributeFilter: ['src', 'srcset']})

  // init observer for node background being modify
  const styleObserver = new MutationObserver(mutationsList => {
    for (const mutation of mutationsList) {
      mutation.target.removeAttribute('no-bg')
      mutation.target.removeAttribute('iv-bg')
      mutation.target.removeAttribute('iv-width')
      mutation.target.removeAttribute('iv-height')
    }
  })
  styleObserver.observe(document.body, {attributes: true, subtree: true, attributeFilter: ['style']})

  //==========utility==========
  function checkKey(e, hotkey) {
    const keyList = hotkey.split('+').map(str => str.trim())
    const key = keyList[keyList.length - 1] === e.key.toUpperCase()
    const ctrl = keyList.includes('Ctrl') === e.ctrlKey
    const alt = keyList.includes('Alt') === e.altKey || e.getModifierState('AltGraph')
    const shift = keyList.includes('Shift') === e.shiftKey
    return key && ctrl && alt && shift
  }

  // string search
  const cachedExtensionMatch = (function () {
    const extensionRegex = /(.*?[=.](?:jpeg|jpg|png|gif|webp|bmp|tiff|avif))(?!\/)/i
    const matchCache = new Map()
    return str => {
      if (str.startsWith('data')) return null

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
  const cachedGetRawFilename = (function () {
    const filenameCache = new Map()
    return str => {
      if (str.startsWith('data')) return null

      const cache = filenameCache.get(str)
      if (cache !== undefined) return cache

      const rawFilename = str.replace(/[-_]\d{3,4}x(?:\d{3,4})?\./, '.')
      filenameCache.set(str, rawFilename)
      return rawFilename
    }
  })()
  const getRawUrl = (function () {
    const rawUrlCache = new Map()
    return src => {
      if (src.startsWith('data') || src.startsWith('blob')) return src

      const cache = rawUrlCache.get(src)
      if (cache !== undefined) return cache

      const rawFilenameUrl = cachedGetRawFilename(src)
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
  const getPathIdentifier = (function () {
    const pathIdCache = new Map()
    return src => {
      if (src.startsWith('data') || src.startsWith('blob')) return null

      const cache = pathIdCache.get(src)
      if (cache !== undefined) return cache

      try {
        const url = new URL(src, document.baseURI)
        const dotIndex = url.pathname.lastIndexOf('.')
        const pathname = dotIndex === -1 ? url.pathname : url.pathname.slice(0, dotIndex)
        if (url.search === '') {
          pathIdCache.set(src, pathname)
          return pathname
        }
        const query = url.search
          .split('&')
          .filter(attr => attr.split('=').at(-1).length > 6)
          .reduce((last, curr) => (curr.length > last.length ? curr : last), '')
        const pathId = pathname + query
        pathIdCache.set(src, pathId)
        return pathId
      } catch (error) {
        pathIdCache.set(src, null)
        return null
      }
    }
  })()
  const getFilename = (function () {
    const rawFilenameCache = new Map()
    return src => {
      const cache = rawFilenameCache.get(src)
      if (cache !== undefined) return cache

      const filename = src.split('?')[0].split('/').at(-1).split('.')[0]
      rawFilenameCache.set(src, filename)
      return filename
    }
  })()

  // check function
  function isImageViewerExist() {
    return document.body.classList.contains('iv-attached')
  }
  function isLazyClass(className) {
    if (className === '') return false
    const lower = className.toLowerCase()
    return lower.includes('lazy') || lower.includes('loading')
  }
  function isPromiseComplete(promise) {
    const symbol = Symbol('check')
    const signal = new Promise(resolve => setTimeout(resolve, 0, symbol))
    return Promise.race([promise, signal]).then(result => result !== symbol)
  }
  async function waitPromiseComplete(promise, maxWait) {
    await Promise.race([promise, new Promise(resolve => setTimeout(resolve, maxWait))])
    return isPromiseComplete(promise)
  }

  // dom search
  function deepQuerySelectorAll(target, tagName, selector) {
    const result = []
    const stack = [target]
    while (stack.length) {
      const current = stack.pop()
      for (const node of current.querySelectorAll(`${selector}, *:not([no-shadow])`)) {
        if (node.tagName === tagName) result.push(node)
        if (node.shadowRoot) {
          stack.push(node.shadowRoot)
        } else {
          node.setAttribute('no-shadow', '')
        }
      }
    }
    return result
  }
  const getMainContainer = (function () {
    // calculate document size is very slow
    let windowWidth = document.documentElement.clientWidth
    let windowHeight = document.compatMode === 'CSS1Compat' ? document.documentElement.clientHeight : document.body.clientHeight
    window.addEventListener('resize', () => {
      windowWidth = document.documentElement.clientWidth
      windowHeight = document.compatMode === 'CSS1Compat' ? document.documentElement.clientHeight : document.body.clientHeight
    })
    return () => {
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
  })()

  // wrapper size
  function isOneToOne(wrapperList, imageCountList, rawWidth, rawHeight, wrapperWidth, wrapperHeight) {
    const imageCount = imageCountList.reduce((a, b) => a + b, 0)
    if (imageCount !== wrapperList.length) return false
    let flag = true
    for (let i = 0; i < rawWidth.length; i++) {
      // image size should close to container size
      flag &&= rawWidth[i] + 5 >= wrapperWidth[i] || rawHeight[i] + 5 >= wrapperHeight[i]
    }
    return flag
  }
  function isLargeContainer(wrapperList, imageCountList) {
    const maxImageCount = Math.max(...imageCountList)
    const largeContainerCount = imageCountList.filter(num => num === maxImageCount).length
    const isLargeContainer = maxImageCount >= 5 && wrapperList.length - largeContainerCount < 3
    return isLargeContainer
  }
  function processWrapperList(wrapperList) {
    wrapperList = wrapperList[0].shadowRoot ? wrapperList.map(node => node.shadowRoot) : wrapperList
    // treat long size as width
    const wrapperWidth = []
    const wrapperHeight = []
    // store raw value of each img
    const rawWidth = []
    const rawHeight = []
    const imageCountList = []
    for (const wrapper of wrapperList) {
      // ad may use same wrapper and adblock set it to display: none
      if (wrapper.offsetParent === null && wrapper.style.position !== 'fixed') continue

      const imgList = wrapper.querySelectorAll('img')
      const imageSet = new Set([...imgList].map(img => getFilename(img.src)))
      imageCountList.push(imageSet.size)
      if (imgList.length === 0) continue

      const widthList = []
      const heightList = []
      for (const img of imgList) {
        const rect = img.getBoundingClientRect()
        const width = Math.min(rect.width, img.naturalWidth)
        const height = Math.min(rect.height, img.naturalHeight)
        rawWidth.push(width)
        rawHeight.push(height)
        if (width > height) {
          widthList.push(width)
          heightList.push(height)
        } else {
          widthList.push(height)
          heightList.push(width)
        }
        if (imgList.length !== imageSet.size) break
      }
      const maxWidth = Math.max(...widthList)
      const maxHeight = Math.max(...heightList)
      wrapperWidth.push(maxWidth)
      wrapperHeight.push(maxHeight)
    }

    return {imageCountList, rawWidth, rawHeight, wrapperWidth, wrapperHeight}
  }
  function updateSizeByWrapper(wrapperList, domWidth, domHeight, options) {
    const {imageCountList, rawWidth, rawHeight, wrapperWidth, wrapperHeight} = processWrapperList(wrapperList)
    const isCustomElement = wrapperList[0].tagName.includes('-')
    const useMinSize = isCustomElement || isLargeContainer(wrapperList, imageCountList)
    const useHalfSize = !useMinSize && isOneToOne(wrapperList, imageCountList, rawWidth, rawHeight, wrapperWidth, wrapperHeight)

    const getMinSize = rawSizeList => Math.min(...rawSizeList.filter(Boolean))
    const getHalfSize = (rawSizeList, optionSize) => Math.min(...rawSizeList.filter(size => size >= optionSize)) / 2
    const getRefSize = (sizeList, domSize, optionSize) => Math.min(...sizeList.filter(s => s * 1.5 >= domSize || s * 1.2 >= optionSize))

    // treat long size as width
    const [long, short] = domWidth > domHeight ? [domWidth, domHeight] : [domHeight, domWidth]
    const [optionLong, optionShort] = options.minWidth > options.minHeight ? [options.minWidth, options.minHeight] : [options.minHeight, options.minWidth]
    const finalWidth = useMinSize ? getMinSize(rawWidth) : useHalfSize ? getHalfSize(rawWidth, optionLong) : getRefSize(wrapperWidth, long, optionLong)
    const finalHeight = useMinSize ? getMinSize(rawHeight) : useHalfSize ? getHalfSize(rawHeight, optionShort) : getRefSize(wrapperHeight, short, optionShort)

    // not allow size below 50 to prevent icon
    const finalSize = Math.max(useMinSize ? 0 : 50, Math.min(finalWidth, finalHeight))
    options.minWidth = Math.min(finalSize, options.minWidth)
    options.minHeight = Math.min(finalSize, options.minHeight)
  }

  function getWrapperList(wrapper) {
    if (!wrapper) return []
    const rootNode = wrapper.getRootNode()
    if (rootNode !== document) return deepQuerySelectorAll(document.body, rootNode.host.tagName.toUpperCase(), rootNode.host.tagName)
    const classList = wrapper ? '.' + [...wrapper?.classList].map(CSS.escape).join(', .') : ''
    const wrapperList = wrapper ? document.querySelectorAll(`div:is(${classList}):has(img):not(:has(div:is(${classList}) img))`) : []
    return wrapperList
  }
  function getDomSelector(dom) {
    let curr = dom.parentElement
    let selector = dom.tagName.toLowerCase()
    while (curr.parentElement) {
      if (curr.classList.length > 1) {
        selector = curr.tagName.toLowerCase() + ':is(.' + [...curr.classList].map(CSS.escape).join(', .') + ') > ' + selector
      } else if (curr.classList.length === 1) {
        selector = curr.tagName.toLowerCase() + '.' + CSS.escape(curr.classList[0]) + ' > ' + selector
      } else {
        selector = curr.tagName.toLowerCase() + ' > ' + selector
      }
      curr = curr.parentElement
    }
    return selector
  }
  function updateSizeBySelector(domWidth, domHeight, container, tagName, selector, options) {
    // skip img with data URL
    const domList = deepQuerySelectorAll(container, tagName, selector, options)
    const targetDom = tagName === 'img' ? domList.filter(img => !img.src.startsWith('data')) : domList

    const widthList = []
    const heightList = []
    for (const dom of targetDom) {
      const {width, height} = dom.getBoundingClientRect()
      if (width === 0 || height === 0) continue
      widthList.push(width)
      heightList.push(height)
    }

    // use rect size
    const useWeightSize = heightList.every(h => h === domHeight)
    if (useWeightSize) {
      const targetWidth = Math.min(...widthList) - 3
      options.minWidth = Math.min(targetWidth, options.minWidth)
      options.minHeight = Math.min(domHeight, options.minHeight)
      return
    }
    const useHeightSize = widthList.every(w => w === domWidth)
    if (useHeightSize) {
      const targetHeight = Math.min(...heightList) - 3
      options.minWidth = Math.min(domWidth, options.minWidth)
      options.minHeight = Math.min(targetHeight, options.minHeight)
      return
    }

    // use ref size
    const refSizeList = []
    for (let i = 0; i < widthList.length; i++) {
      const width = widthList[i]
      const height = heightList[i]
      refSizeList.push(width > height ? [width, height] : [height, width])
    }
    refSizeList.sort((a, b) => b[0] + b[1] - a[0] - a[1])

    const [maxLong, maxShort] = domWidth > domHeight ? [domWidth, domHeight] : [domHeight, domWidth]
    const refIndex = refSizeList.findIndex(size => size[0] === maxLong && size[1] === maxShort)
    const factor = 1.2
    let minLong = maxLong / factor
    let minShort = maxShort / factor
    for (let i = refIndex + 1; i < refSizeList.length; i++) {
      const [long, short] = refSizeList[i]
      if (short >= minShort && long >= minLong) {
        minLong = Math.min(long / factor, minLong)
        minShort = Math.min(short / factor, minShort)
      }
    }

    const finalSize = Math.min(minLong, minShort) * factor - 3
    options.minWidth = Math.min(finalSize, options.minWidth)
    options.minHeight = Math.min(finalSize, options.minHeight)
  }

  // scroll unlazy
  async function slowScrollThoughDocument(currentX, currentY) {
    if (!isImageViewerExist()) return

    const haveNewImage = (function () {
      const imageCount = ImageViewer('get_image_list').length
      let changed = true
      setTimeout(() => (changed = false), 5000)
      return () => changed || (changed = imageCount !== ImageViewer('get_image_list').length)
    })()

    const container = getMainContainer()
    const totalHeight = container.scrollHeight
    container.scrollTo(0, 0)

    const expectedCapacity = totalHeight / 400
    const waitScrollComplete = async () => {
      const imageCount = ImageViewer('get_image_list').length
      if (imageCount < expectedCapacity) {
        await new Promise(resolve => setTimeout(resolve, 500))
        return
      }
      let tempTop = -1
      while (tempTop !== container.scrollTop) {
        tempTop = container.scrollTop
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      const waitTime = ImageViewer('get_image_list').length / 10
      await new Promise(resolve => setTimeout(resolve, waitTime))
    }

    let currTop = -1
    while (currTop !== container.scrollTop && currTop < totalHeight * 3 && haveNewImage() && isImageViewerExist()) {
      currTop = container.scrollTop
      container.scrollBy({top: window.innerHeight * 2, behavior: 'smooth'})
      await waitScrollComplete()
    }
    if (isImageViewerExist()) container.scrollTo(currentX, currentY)
  }
  async function scrollThoughDocument(currentX, currentY) {
    const container = getMainContainer()
    const totalHeight = container.scrollHeight
    const scrollDelta = window.innerHeight * 1.5
    let top = 0
    while (top < totalHeight && isImageViewerExist()) {
      top += scrollDelta
      container.scrollTo(currentX, top)
      await new Promise(resolve => setTimeout(resolve, 150))
    }
    container.scrollTo(currentX, currentY)
  }
  async function tryActivateLazyImage(isDomChanged) {
    const container = getMainContainer()
    container.scrollTo(0, 0)
    container.scrollBy({top: window.innerHeight * 2})
    await new Promise(resolve => setTimeout(resolve, 100))

    const domChanged = isDomChanged()
    if (domChanged || !isImageViewerExist()) return

    let maxHeight = 0
    for (const img of document.getElementsByTagName('img')) {
      const height = img.clientHeight
      maxHeight = Math.max(maxHeight, height)
    }
    container.scrollBy({top: maxHeight * 2})
  }
  async function scrollUnlazy() {
    if (scrollUnlazyFlag) return

    scrollUnlazyFlag = true
    while (document.readyState !== 'complete') {
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    await new Promise(resolve => setTimeout(resolve, 500))
    if (!isImageViewerExist()) {
      scrollUnlazyFlag = false
      return
    }

    await new Promise(resolve => (scrollRelease = resolve))

    const container = getMainContainer()
    const currentX = container.scrollLeft
    const currentY = container.scrollTop
    let domChanged = false
    const scrollObserver = new MutationObserver(mutationsList => {
      scrollObserver.disconnect()
      domChanged = true
      // lazy image activated by scroll
      console.log('Unlazy by scroll')
      let found = false
      for (const mutation of mutationsList) {
        // image updated to real url
        const element = mutation.target
        if (element.tagName === 'IMG') {
          found = !element.hasAttribute('iv-observing') && !element.hasAttribute('iv-image')
          if (found) break
        }
        // new image added to the page
        if (mutation.addedNodes.length) {
          found = [...mutation.addedNodes].flatMap(node => [node, ...node.childNodes]).some(node => node.tagName === 'IMG')
          if (found) break
        }
      }
      if (!found) {
        container.scrollTo(currentX, currentY)
        return
      }
      scrollThoughDocument(currentX, currentY)
    })
    scrollObserver.observe(document.body, {
      attributes: true,
      subtree: true,
      childList: true,
      attributeFilter: ['src', 'srcset']
    })
    setTimeout(() => {
      scrollObserver.disconnect()
      if (!domChanged) container.scrollTo(currentX, currentY)
    }, 1000)

    // extra check for uncommon case
    // eg. lazy background image
    const imageListLength = ImageViewer('get_image_list').length
    setTimeout(() => {
      if (!domChanged && imageListLength !== ImageViewer('get_image_list').length) {
        slowScrollThoughDocument(currentX, currentY)
      }
    }, 2000)

    const isDomChanged = () => domChanged
    tryActivateLazyImage(isDomChanged)
  }

  // auto scroll
  function startAutoScroll() {
    let stopFlag = true
    const isStopped = () => stopFlag
    const action = () => {
      if (!isImageViewerExist()) return
      const container = getMainContainer()
      const scrollY = container.scrollTop
      const imageList = document.getElementsByTagName('img')

      let currBottom = 0
      let bottomImg = null
      for (const img of imageList) {
        const bottomAttr = img.getAttribute('iv-bottom')
        const bottom = bottomAttr ? Number(bottomAttr) : img.getBoundingClientRect().bottom + scrollY
        img.setAttribute('iv-bottom', bottom)
        if (bottom > currBottom) {
          currBottom = bottom
          bottomImg = img
        }
      }
      bottomImg.scrollIntoView({behavior: 'instant', block: 'start'})
      if (container.scrollTop > scrollY) return

      // allow scroll to document end on edge case
      if (container.scrollHeight - container.scrollTop < window.innerHeight * 2) {
        container.scrollBy({top: window.innerHeight * 2})
      }
      if (container.scrollTop > scrollY) return

      // check if bottom invalid when no scroll
      let invalid = false
      for (const img of imageList) {
        const bottomAttr = img.getAttribute('iv-bottom')
        if (bottomAttr === null) continue
        const scrollBottom = Number(bottomAttr)
        const bottom = img.getBoundingClientRect().bottom + scrollY
        if (scrollBottom !== bottom) {
          invalid = true
          break
        }
      }
      // return or recalculate bottom
      if (!invalid) return
      for (const img of imageList) {
        const bottom = img.getBoundingClientRect().bottom + scrollY
        img.setAttribute('iv-bottom', bottom)
      }
    }
    const timer = async () => {
      stopFlag = false
      const container = getMainContainer()
      let lastY = container.scrollTop
      let lastImageCount = 0
      let count = 0
      while (lastY < container.scrollHeight && count < 5) {
        if (!isImageViewerExist()) break

        while (document.visibilityState !== 'visible') {
          await new Promise(resolve => setTimeout(resolve, 100))
        }

        // wait image collection settle
        let notStarted = true
        let notComplete = true
        let currentImageCount = ImageViewer('get_image_list').length
        let completeCount = 0
        while (notStarted || notComplete) {
          await new Promise(resolve => (scrollRelease = resolve))
          const newImageCount = ImageViewer('get_image_list').length
          notStarted = lastImageCount === currentImageCount
          notComplete = currentImageCount !== newImageCount
          currentImageCount = newImageCount
          if (notComplete === false) completeCount++
          if (completeCount === 3) break
        }
        lastImageCount = currentImageCount

        // wait image load complete
        let loadingImageCount = deepQuerySelectorAll(document.body, 'IMG', 'img[iv-checking]').length
        while (loadingImageCount > 0) {
          await new Promise(resolve => setTimeout(resolve, 100))
          loadingImageCount = deepQuerySelectorAll(document.body, 'IMG', 'img[iv-checking]').length
        }

        if (!enableAutoScroll) break
        action()

        // check scroll complete
        await new Promise(resolve => setTimeout(resolve, 500))
        if (lastY === container.scrollTop && isImageViewerExist()) {
          count++
        } else {
          count = 0
        }
        lastY = container.scrollTop
      }
      stopFlag = true
    }

    timer()
    return {isStopped, timer}
  }
  function stopAutoScrollOnExit(newNodeObserver, startX, startY) {
    let scrollFlag = false

    const originalScrollIntoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function () {
      if (!isImageViewerExist()) {
        scrollFlag = true
      }
      const container = getMainContainer()
      let currX = container.scrollLeft
      let currY = container.scrollTop
      originalScrollIntoView.apply(this, arguments)
      // for unknown reason can't move to correct position with single scroll
      while (currX !== container.scrollLeft || currY !== container.scrollTop) {
        currX = container.scrollLeft
        currY = container.scrollTop
        originalScrollIntoView.apply(this, arguments)
      }
    }

    const originalScrollTo = Element.prototype.scrollTo
    Element.prototype.scrollTo = function () {
      if (!isImageViewerExist()) {
        scrollFlag = true
      }
      originalScrollTo.apply(this, arguments)
    }

    const imageViewerObserver = new MutationObserver(() => {
      if (isImageViewerExist()) return
      autoScrollFlag = false
      imageViewerObserver.disconnect()
      newNodeObserver.disconnect()
      setTimeout(() => {
        const container = getMainContainer()
        if (!scrollFlag) container.scrollTo(startX, startY)
        Element.prototype.scrollIntoView = originalScrollIntoView
        Element.prototype.scrollTo = originalScrollTo
      }, 500)
    })
    imageViewerObserver.observe(document.body, {attributes: true, attributeFilter: ['class']})
  }
  async function autoScroll() {
    if (autoScrollFlag) return

    autoScrollFlag = true
    await new Promise(resolve => setTimeout(resolve, 500))
    if (!isImageViewerExist()) {
      autoScrollFlag = false
      return
    }

    const container = getMainContainer()
    const startX = container.scrollLeft
    const startY = container.scrollTop
    const imageListLength = ImageViewer('get_image_list').length

    if (imageListLength > 50) {
      const totalHeight = container.scrollHeight
      const targetHeight = Math.min(container.scrollTop, totalHeight - window.innerHeight * 10)
      container.scrollTo(startX, targetHeight)
    }

    const {isStopped, timer} = startAutoScroll()

    let existNewDom = false
    const newNodeObserver = new MutationObserver(() => {
      existNewDom = true
      if (isStopped()) timer()
    })
    newNodeObserver.observe(document.body, {childList: true, subtree: true})
    setTimeout(() => {
      if (!existNewDom || imageListLength === ImageViewer('get_image_list').length) {
        const container = getMainContainer()
        const totalHeight = container.scrollHeight
        container.scrollTo(startX, totalHeight)
      }
    }, 3000)

    stopAutoScrollOnExit(newNodeObserver, startX, startY)
  }

  // image preload
  async function updateImageSrc(img, src) {
    img.src = src
    img.srcset = src
    const picture = img.parentNode
    if (picture?.tagName === 'PICTURE') {
      for (const source of picture.querySelectorAll('source')) {
        source.srcset = src
      }
    }
    const srcUrl = new URL(img.src, document.baseURI)
    while (srcUrl.href !== img.currentSrc) {
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  async function preloadImage(img, src) {
    const release = await semaphore.acquire()
    const success = await new Promise(resolve => {
      const temp = new Image()
      temp.onload = () => resolve(true)
      temp.onerror = () => resolve(false)
      temp.loading = 'eager'
      temp.referrerPolicy = img.referrerPolicy
      temp.src = src
    })
    release()
    return success
  }

  // attr unlazy
  async function fetchBitSize(url) {
    if (corsHostSet.has(url.hostname)) return 0

    const release = await semaphore.acquire()
    try {
      const method = url.href.startsWith('blob:') ? 'GET' : 'HEAD'
      const res = await fetch(url.href, {method, signal: AbortSignal.timeout(5000)})
      if (!res.ok) return 0
      if (res.redirected) return -1
      const type = res.headers.get('Content-Type')
      const length = res.headers.get('Content-Length')
      if (type?.startsWith('image') || (type === 'application/octet-stream' && cachedExtensionMatch(url.href))) {
        const size = Number(length)
        return size
      }
      return 0
    } finally {
      release()
    }
  }
  function getImageBitSize(src) {
    if (!src || src === 'about:blank' || src.startsWith('data')) return 0

    const cache = srcBitSizeMap.get(src)
    if (cache !== undefined) return cache

    const promise = new Promise(_resolve => {
      const resolve = size => {
        srcBitSizeMap.set(src, size)
        _resolve(size)
      }

      let waiting = false
      const updateSize = size => {
        if (size) resolve(size)
        else if (waiting) waiting = false
        else if (src.startsWith('blob')) return resolve(Number.MAX_SAFE_INTEGER)
        else resolve(0)
      }

      // protocol-relative URL
      const url = new URL(src, document.baseURI)
      const href = url.href
      if (url.hostname !== location.hostname) {
        waiting = true
        safeSendMessage({msg: 'get_size', url: href}).then(updateSize)
      }
      fetchBitSize(url)
        .then(updateSize)
        .catch(error => {
          if (error.name !== 'TimeoutError') corsHostSet.add(url.hostname)
          if (url.hostname !== location.hostname) updateSize(0)
          else safeSendMessage({msg: 'get_size', url: href}).then(updateSize)
        })
    })

    srcBitSizeMap.set(src, promise)
    return promise
  }
  async function getImageRealSize(src) {
    const cache = srcRealSizeMap.get(src)
    if (cache !== undefined) return cache

    const release = await semaphore.acquire()
    const promise = new Promise(_resolve => {
      const resolve = size => {
        srcRealSizeMap.set(src, size)
        _resolve(size)
        release()
      }

      const img = new Image()
      img.onload = () => resolve(Math.min(img.naturalWidth, img.naturalHeight))
      img.onerror = () => resolve(0)
      setTimeout(() => img.complete || resolve(0), 10000)
      img.src = src
    })

    srcRealSizeMap.set(src, promise)
    return promise
  }
  async function getBetterUrl(currentSrc, bitSize, naturalSize, newURL) {
    const baseSize = bitSize || naturalSize
    const getSizeFunction = bitSize ? getImageBitSize : getImageRealSize
    const lazySize = await getSizeFunction(newURL)
    if (lazySize === 0 || lazySize < baseSize) return null
    if (lazySize > baseSize) return newURL
    // when same size
    const isSameImage = getRawUrl(currentSrc) === getRawUrl(newURL) || currentSrc.split('?')[0].split('/').at(-1) === newURL.split('?')[0].split('/').at(-1)
    if (!isSameImage) return newURL
    return null
  }
  async function checkImageAttr(img, attrList) {
    img.setAttribute('iv-checking', '')
    img.setAttribute('iv-image', '')
    const successList = []
    let lastIndex = 0
    let complete = false
    while (!complete) {
      // init var for current url and size
      const currentSrc = img.currentSrc
      const realSrc = currentSrc.replace(/https?:/, protocol)
      const currentSize = Math.min(img.naturalWidth, img.naturalHeight)
      const [bitSize, naturalSize] = await Promise.all([getImageBitSize(realSrc), currentSize || getImageRealSize(realSrc)])

      // loop thought remaining attr
      while (lastIndex < attrList.length) {
        const {name, url} = attrList[lastIndex++]
        complete = lastIndex === attrList.length
        const newURL = url.replace(/https?:/, protocol).replace(/^\/(?:[^/])/, origin)
        const betterUrl = await getBetterUrl(currentSrc, bitSize, naturalSize, newURL)
        if (betterUrl === null) continue

        // preload image
        const preloading = preloadImage(img, betterUrl)
        const done = await waitPromiseComplete(preloading, 5000)
        // count overtime as success
        const success = done ? await preloading : true
        if (!success) {
          console.log(`Failed to load ${betterUrl}`)
          continue
        }

        // update attr
        successList.push(name)
        const realAttrName = name.startsWith('raw ') ? name.slice(4) : name
        if (done) {
          await updateImageSrc(img, betterUrl)
          img.removeAttribute(realAttrName)
          badImageSet.add(currentSrc)
          break
        }
        // place action to callback
        console.log(`Image preload overtime: ${betterUrl}`)
        preloading
          .then(success => success && updateImageSrc(img, betterUrl))
          .then(() => {
            img.removeAttribute(realAttrName)
            badImageSet.add(currentSrc)
          })
        break
      }
    }
    if (successList.length) {
      for (const className of img.classList) {
        if (isLazyClass(className)) img.classList.remove(className)
      }
    }
    img.removeAttribute('iv-checking')
    return successList
  }

  // unlazy main function
  function getUnlazyAttrList(img) {
    const src = img.currentSrc || img.src
    const rawUrl = getRawUrl(src)
    const attrList = []

    // check attributes
    for (const attr of img.attributes) {
      if (passList.has(attr.name) || !attr.value.match(urlRegex)) continue

      const attrUrl = new URL(attr.value, document.baseURI).href
      if (attrUrl !== src) {
        attrList.push({name: attr.name, url: attrUrl})
      }
      const rawAttrUrl = getRawUrl(attrUrl)
      if (rawAttrUrl !== attrUrl && rawAttrUrl !== rawUrl) {
        attrList.push({name: 'raw ' + attr.name, url: rawAttrUrl})
      }
    }

    // check srcset and src
    if (img.srcset && img.srcset !== src) {
      const srcsetList = img.srcset
        .split(',')
        .map(str => str.trim().split(/ +/))
        .map(([url, size]) => [url, size ? Number(size.slice(0, -1)) : 1])
        .sort((a, b) => b[1] - a[1])
      attrList.push({name: 'srcset', url: srcsetList[0][0]})
    }
    if (rawUrl !== src) {
      attrList.push({name: 'raw url', url: rawUrl})
    }

    // check url path
    try {
      const url = new URL(src, document.baseURI)
      const pathname = url.pathname
      const search = url.search
      if (pathname.match(/[-_]thumb(?=nail)?\./)) {
        const nonThumbnailPath = pathname.replace(/[-_]thumb(?=nail)?\./, '.')
        const nonThumbnail = src.replace(pathname, nonThumbnailPath)
        attrList.push({name: 'non thumbnail path', url: nonThumbnail})
      }

      // check url parameters
      if (!src.includes('?')) throw new Error()
      if (!pathname.includes('.')) {
        const extMatch = search.match(/jpeg|jpg|png|gif|webp|bmp|tiff|avif/)
        if (extMatch) {
          const filenameWithExt = pathname + '.' + extMatch[0]
          const rawExtension = src.replace(pathname + search, filenameWithExt)
          attrList.push({name: 'raw extension', url: rawExtension})
        }
      }
      if (search.includes('width=') || search.includes('height=')) {
        const noSizeQuery = search.replace(/&?width=\d+|&?height=\d+/g, '')
        const rawQuery = src.replace(search, noSizeQuery)
        attrList.push({name: 'no size query', url: rawQuery})
      }
      const noQuery = src.replace(pathname + search, pathname)
      attrList.push({name: 'no query', url: noQuery})
    } catch (error) {}

    // check parent anchor
    const anchor = img.closest('a')
    if (anchor && anchor.href !== src && anchor.href.match(urlRegex)) {
      const anchorHaveExt = cachedExtensionMatch(anchor.href) !== null
      const rawHaveExt = cachedExtensionMatch(rawUrl) !== null
      const maybeLarger = anchorHaveExt || anchorHaveExt === rawHaveExt || rawUrl.slice(0, 12).includes('cdn.')
      if (maybeLarger) attrList.push({name: 'parent anchor', url: anchor.href})
    }
    return attrList.filter(attr => encodeURI(attr.url) !== src)
  }
  function getUnlazyImageList(minWidth, minHeight) {
    const imgWithAttrList = []
    let allComplete = true

    const targetImageList = deepQuerySelectorAll(document.body, 'IMG', 'img:not([iv-image])')
    for (const img of targetImageList) {
      img.loading = 'eager'
      if (img.getAttribute('decoding')) img.decoding = 'sync'

      const attrList = getUnlazyAttrList(img)
      if (attrList.length === 0) {
        img.setAttribute('iv-image', '')
        continue
      }
      // checkImageAttr() will fail if image is still loading
      if (!img.complete) {
        allComplete = false
        continue
      }

      // check url and size
      const lazy = img.src === '' || img.naturalWidth === 0 || img.naturalHeight === 0
      if (lazy) {
        imgWithAttrList.push([img, attrList])
        continue
      }

      // check class name
      if (isLazyClass(img.className)) {
        imgWithAttrList.push([img, attrList])
        continue
      }

      // init images with pass size filter
      const {width, height} = img.getBoundingClientRect()
      if (width >= minWidth && height >= minHeight) {
        imgWithAttrList.push([img, attrList])
      }
    }
    return {imgWithAttrList, allComplete}
  }
  function unlazyImage(minWidth, minHeight) {
    const {imgWithAttrList, allComplete} = getUnlazyImageList(minWidth, minHeight)
    const listSize = imgWithAttrList.length
    if (listSize === 0) return [allComplete, []]

    console.log(`Try to unlazy ${listSize} image`)
    const asyncList = imgWithAttrList.map(([img, attrList]) => checkImageAttr(img, attrList))

    return [false, asyncList]
  }
  function clearWindowBackup(options) {
    const allImageUrlSet = new Set(getImageListWithoutFilter(options).map(data => data.src))
    const backup = window.backupImageList
    for (let i = backup.length - 1; i >= 0; i--) {
      if (!allImageUrlSet.has(backup[i].src)) backup.splice(i, 1)
    }
  }
  async function simpleUnlazyImage(options) {
    const minWidth = Math.min(options.minWidth, 100)
    const minHeight = Math.min(options.minHeight, 100)

    let allComplete = false
    const asyncList = []
    while (!allComplete) {
      const [complete, taskList] = unlazyImage(minWidth, minHeight)
      asyncList.push(...taskList)
      if (complete) {
        allComplete = await isPromiseComplete(Promise.all(asyncList))
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    const resultList = (await Promise.all(asyncList)).filter(result => result.length > 0)
    const lazyList = resultList.flat()
    if (lazyList.length > resultList.length) console.log('Multiple unlazy attributes found')
    const attrCount = {}
    for (const name of lazyList) {
      if (attrCount[name]) {
        attrCount[name]++
      } else {
        attrCount[name] = 1
      }
    }
    for (const name in attrCount) {
      console.log(`Unlazy ${attrCount[name]} img with ${name}`)
    }

    if (!unlazyFlag) {
      unlazyFlag = true
      console.log('First unlazy complete')
      clearWindowBackup(options)
    }

    enableAutoScroll ? autoScroll() : scrollUnlazy()
  }

  // before unlazy
  function processLazyPlaceholder() {
    const lazySrcList = [...document.getElementsByTagName('img')]
      .filter(image => image.src && (image.naturalWidth + image.naturalHeight < 16 || image.src.endsWith('.gif') || isLazyClass(image.className)))
      .map(image => image.currentSrc.replace(/https?:/, protocol))
    if (lazySrcList.length === 0) return

    const countMap = {}
    for (const src of lazySrcList) {
      if (countMap[src] === undefined) {
        countMap[src] = 1
      } else {
        countMap[src]++
      }
    }

    for (const src in countMap) {
      if (countMap[src] >= 5) {
        console.log(`Found lazy src appear ${countMap[src]} times ${src}`)
        srcBitSizeMap.set(src, -1)
        srcRealSizeMap.set(src, -1)
        badImageSet.add(src)
      }
    }
  }
  function fakeUserHover() {
    const enterEvent = new CustomEvent('mouseenter')
    const overEvent = new CustomEvent('mouseover')
    const leaveEvent = new CustomEvent('mouseleave')
    const targetList = document.getElementsByTagName('img')
    if (targetList.length > 300) return
    for (const image of targetList) {
      image.dispatchEvent(enterEvent)
      image.dispatchEvent(overEvent)
      image.dispatchEvent(leaveEvent)
    }
  }
  async function checkPseudoElement(href) {
    const [dataUrl] = await safeSendMessage({msg: 'request_cors_url', url: href})
    const res = await fetch(dataUrl)
    const cssText = await res.text()

    const matchList = cssText
      .replaceAll(/[\r\n ]/g, '')
      .split('}')
      .map(str => (str.startsWith('@media') ? str.split('{')[1] : str))
      .map(str => str.match(/:(?:before|after).+background-image:url\((.+)\)/))
      .filter(Boolean)

    for (const match of matchList) {
      const [selector, position] = match.input
        .split('{')[0]
        .split(',')
        .filter(s => s.includes(':'))[0]
        .split(':')
      const domList = document.querySelectorAll(selector)
      if (domList.length === 0) continue

      const dom = domList[0]
      const pseudoCss = window.getComputedStyle(dom, `::${position}`)
      if (pseudoCss.content === 'none') continue

      const url = match[1]
      const realSize = await getImageRealSize(url)
      const width = Math.min(realSize, Number(pseudoCss.width.slice(0, -2)))
      const height = Math.min(realSize, Number(pseudoCss.height.slice(0, -2)))
      pseudoImageDataList.push([url, dom, width, height])
    }
  }
  function checkPseudoCss() {
    pseudoImageDataList.length = 0
    for (const sheet of document.styleSheets) {
      const href = sheet.href
      if (href) checkPseudoElement(href)
    }
  }
  function getDomainSetting(rawDomainList) {
    const domainList = []
    const regexList = []
    for (const str of rawDomainList) {
      if (str[0] === '/' && str[str.length - 1] === '/') {
        regexList.push(new RegExp(str.slice(1, -1)))
      } else {
        domainList.push(str)
      }
    }
    let result = domainList.some(domain => domain === location.hostname || domain === location.hostname.replace('www.', ''))
    result ||= regexList.some(regex => regex.test(location.href))
    return result
  }
  async function createUnlazyRace(options) {
    // slow connection alert
    if (lastUnlazyTask === null) {
      setTimeout(() => {
        if (unlazyFlag) return
        const unlazyList = deepQuerySelectorAll(document.body, 'IMG', 'img:not([iv-image])')
        const stillLoading = [...unlazyList].some(img => !img.complete && img.loading !== 'lazy')
        if (stillLoading) {
          console.log('Slow connection, images still loading')
          alert('Slow connection, images still loading')
        }
      }, 10000)
    }

    // set timeout for unlazy
    const unlazyComplete = await isPromiseComplete(lastUnlazyTask)
    if (unlazyComplete) {
      const clone = structuredClone(options)
      lastUnlazyTask = simpleUnlazyImage(clone)
    }
    const timeout = new Promise(resolve => setTimeout(resolve, 500))
    const race = Promise.race([lastUnlazyTask, timeout])
    return race
  }
  function startUnlazy(options) {
    if (lastUnlazyTask === null) {
      processLazyPlaceholder()
      fakeUserHover()
      checkPseudoCss()
      enableAutoScroll = getDomainSetting(options.autoScrollEnableList)
      disableImageUnlazy = getDomainSetting(options.imageUnlazyDisableList)
    }
    if (lastHref !== '' && lastHref !== location.href) {
      const allImageSrc = new Set(getImageListWithoutFilter(options).map(data => data.src))
      const backupImageSrc = new Set(window.backupImageList.map(data => data.src))
      if (allImageSrc.intersection(backupImageSrc).size < 5) {
        unlazyFlag = false
        scrollUnlazyFlag = false
        lastUnlazyTask = null
        window.backupImageList = []
        ImageViewer('reset_image_list')
      }
    }
    lastHref = location.href
    if (disableImageUnlazy) {
      enableAutoScroll ? autoScroll() : scrollUnlazy()
      return
    }

    const race = createUnlazyRace(options)
    return race
  }

  // get iframe images
  async function getCanvasList(options) {
    const minWidth = options.minWidth || 0
    const minHeight = options.minHeight || 0
    const asyncList = []

    const canvasList = deepQuerySelectorAll(document.body, 'CANVAS', 'canvas')
    for (const canvas of canvasList) {
      const {width, height} = canvas.getBoundingClientRect()
      if (width < minWidth && height < minHeight) continue
      const promise = new Promise(resolve => {
        canvas.toBlob(blob => {
          if (blob.size === 0) resolve(null)
          const url = URL.createObjectURL(blob)
          resolve({src: url, dom: canvas})
        })
      })
      asyncList.push(promise)
    }

    const canvasDataList = await Promise.all(asyncList)
    return canvasDataList.filter(data => data !== null)
  }
  async function getIframeImageList(options) {
    const iframeList = deepQuerySelectorAll(document.body, 'IFRAME', 'iframe')
    const iframeSrcList = iframeList.map(iframe => iframe.src)
    const filteredList = iframeSrcList.filter(src => src !== '' && src !== 'about:blank')
    if (filteredList.length === 0) return []

    const minSize = Math.min(options.minWidth, options.minHeight)
    const message = {msg: 'extract_frames', minSize: minSize}
    if (options.canvasMode) message.canvasMode = true
    const iframeImage = (await safeSendMessage(message)) || []
    if (iframeImage.length === 0) return []

    // src + iframe url
    const uniqueIframeImage = []
    const uniqueIframeImageUrls = new Set()
    for (const image of iframeImage) {
      if (!uniqueIframeImageUrls.has(image[0])) {
        uniqueIframeImageUrls.add(image[0])
        uniqueIframeImage.push(image)
      }
    }

    // src + iframe dom
    const imageDataList = []
    const iframeRedirectSrcList = (await safeSendMessage({msg: 'get_redirect', data: iframeSrcList})) || []
    const rawIframeRedirectSrcList = iframeRedirectSrcList.map(src => src.slice(0, src.indexOf('/', 8)))
    for (const [imageSrc, iframeSrc] of uniqueIframeImage) {
      const index = iframeRedirectSrcList.indexOf(iframeSrc)
      if (index !== -1) {
        imageDataList.push({src: imageSrc, dom: iframeList[index]})
        continue
      }
      // document url maybe change, search index by url origin
      const rawIndex = rawIframeRedirectSrcList.indexOf(iframeSrc)
      if (rawIndex !== -1) {
        imageDataList.push({src: imageSrc, dom: iframeList[rawIndex]})
        continue
      }
      // not found, pass first iframe as fallback
      imageDataList.push({src: imageSrc, dom: iframeList[0]})
    }

    const imageFailureCountMap = ImageViewer('get_image_failure_count')
    const filteredDataList = imageDataList.filter(data => imageFailureCountMap.get(data.src) === undefined || imageFailureCountMap.get(data.src) < 3)
    return filteredDataList
  }

  // get page images
  function processImageDataList(options, imageDataList) {
    const imageFailureCountMap = ImageViewer('get_image_failure_count')
    const isBadImage = options.svgFilter
      ? url => badImageSet.has(url) || imageFailureCountMap.get(url) >= 3 || url.startsWith('data:image/svg') || url.includes('.svg')
      : url => badImageSet.has(url) || imageFailureCountMap.get(url) >= 3

    const filteredDataList = imageDataList.filter(data => !isBadImage(data.src))

    const urlDataMap = new Map()
    const rawUrlConnection = new Map()
    const pathIdConnection = new Map()
    for (const data of filteredDataList) {
      const src = data.src

      const rawUrl = getRawUrl(src)
      if (src === rawUrl) {
        // remove non raw url
        const connection = rawUrlConnection.get(src)
        if (connection instanceof Array) connection.forEach(url => urlDataMap.delete(url))
      } else {
        const cache = urlDataMap.get(rawUrl)
        if (cache !== undefined) continue

        // build connection between url and raw url
        const connection = rawUrlConnection.get(rawUrl)
        if (connection === undefined) rawUrlConnection.set(rawUrl, [src])
        else if (connection instanceof Array) connection.push(src)
      }

      // build connection between url and path id
      const pathId = getPathIdentifier(rawUrl)
      if (pathId !== null) {
        const connection = pathIdConnection.get(pathId)
        if (connection === undefined) pathIdConnection.set(pathId, new Set([src]))
        else if (connection instanceof Set) connection.add(src)
      }

      const cache = urlDataMap.get(src)
      if (cache === undefined) urlDataMap.set(src, data)
      else if (cache.dom.tagName !== 'IMG' && data.dom.tagName === 'IMG') urlDataMap.set(src, data)
    }

    // remove same path id, should be resize query or image endpoint
    for (const connectionSet of pathIdConnection.values()) {
      if (connectionSet.size === 1) continue
      const urlList = Array.from(connectionSet)
      const imageIndex = urlList.map(url => urlDataMap.get(url)).findIndex(data => data && data.dom.tagName === 'IMG')
      if (imageIndex !== -1) {
        // only keep first image
        urlList.splice(imageIndex, 1)
        urlList.forEach(url => urlDataMap.delete(url))
      } else {
        // only keep the shortest src
        urlList
          .sort((a, b) => a.length - b.length)
          .slice(1)
          .forEach(url => urlDataMap.delete(url))
      }
    }

    const uniqueDataList = Array.from(urlDataMap, ([k, v]) => v)
    return uniqueDataList
  }
  function getNodeSize(node) {
    const widthAttr = node.getAttribute('iv-width')
    const heightAttr = node.getAttribute('iv-height')
    if (widthAttr && heightAttr) {
      const width = Number(widthAttr)
      const height = Number(heightAttr)
      return [width, height]
    }
    const {width, height} = node.getBoundingClientRect()
    if (width === 0 || height === 0) {
      node.setAttribute('no-bg', '')
    }
    node.setAttribute('iv-width', width)
    node.setAttribute('iv-height', height)
    return [width, height]
  }
  async function checkBackgroundSize(node, url) {
    const realSize = await getImageRealSize(url)
    const {width, height} = node.getBoundingClientRect()
    node.removeAttribute('no-bg')
    node.setAttribute('iv-bg', url)
    node.setAttribute('iv-width', Math.min(realSize, width))
    node.setAttribute('iv-height', Math.min(realSize, height))
  }
  function getImageListWithoutFilter(options) {
    const imageDataList = []

    const rawImageList = deepQuerySelectorAll(document.body, 'IMG', `img${disableImageUnlazy ? '' : '[iv-image]'}`)
    for (const img of rawImageList) {
      const imgSrc = img.currentSrc || img.src
      imageDataList.push({src: imgSrc, dom: img})
    }

    const videoList = document.querySelectorAll('video[poster]')
    for (const video of videoList) {
      imageDataList.push({src: video.poster, dom: video})
    }

    const uncheckedNodeList = document.querySelectorAll(`body, body *:not([no-bg])${disableImageUnlazy ? '' : ':not([iv-image])'}:not(video[poster])`)
    for (const node of uncheckedNodeList) {
      const attrUrl = node.getAttribute('iv-bg')
      if (attrUrl !== null) {
        imageDataList.push({src: attrUrl, dom: node})
        continue
      }
      // skip xml dom tree
      if (node.tagName.charCodeAt(0) >= 97) {
        node.setAttribute('no-bg', '')
        continue
      }
      const backgroundImage = window.getComputedStyle(node).backgroundImage
      if (backgroundImage === 'none') {
        node.setAttribute('no-bg', '')
        continue
      }
      const bgList = backgroundImage.split(', ').filter(bg => bg.startsWith('url') && !bg.endsWith('.svg")'))
      if (bgList.length !== 0) {
        const url = bgList[0].slice(5, -2)
        imageDataList.push({src: url, dom: node})
        node.setAttribute('iv-bg', url)
        node.setAttribute('iv-width', '0')
        node.setAttribute('iv-height', '0')
        checkBackgroundSize(node, url)
      }
    }

    // pseudo element
    for (const [url, dom] of pseudoImageDataList) {
      imageDataList.push({src: url, dom})
    }

    const uniqueDataList = processImageDataList(options, imageDataList)
    return uniqueDataList
  }
  function getImageList(options) {
    const minWidth = options.minWidth
    const minHeight = options.minHeight
    if (minWidth === 0 && minHeight === 0) {
      return getImageListWithoutFilter(options)
    }

    const imageDataList = []

    const rawImageList = deepQuerySelectorAll(document.body, 'IMG', `img${disableImageUnlazy ? '' : '[iv-image]'}`)
    for (const img of rawImageList) {
      // only client size should be checked in order to bypass large icon or hidden image
      const {width, height} = img.getBoundingClientRect()
      if ((width >= minWidth && height >= minHeight) || img === window.ImageViewerLastDom) {
        // currentSrc might be empty during unlazy or update
        const imgSrc = img.currentSrc || img.src
        imageDataList.push({src: imgSrc, dom: img})
      }
    }

    const videoList = document.querySelectorAll('video[poster]')
    for (const video of videoList) {
      const {width, height} = video.getBoundingClientRect()
      if (width >= minWidth && height >= minHeight) {
        imageDataList.push({src: video.poster, dom: video})
      }
    }

    const uncheckedNodeList = document.querySelectorAll(`body, body *:not([no-bg])${disableImageUnlazy ? '' : ':not([iv-image])'}:not(video[poster])`)
    for (const node of uncheckedNodeList) {
      const [width, height] = getNodeSize(node)
      if (width < minWidth || height < minHeight) continue
      const attrUrl = node.getAttribute('iv-bg')
      if (attrUrl !== null) {
        imageDataList.push({src: attrUrl, dom: node})
        continue
      }
      const nodeStyle = window.getComputedStyle(node)
      const backgroundImage = nodeStyle.backgroundImage
      if (backgroundImage === 'none') {
        node.setAttribute('no-bg', '')
        continue
      }
      const bgList = backgroundImage.split(', ').filter(bg => bg.startsWith('url') && !bg.endsWith('.svg")'))
      if (bgList.length === 0) {
        node.setAttribute('no-bg', '')
        continue
      }
      const url = bgList[0].slice(5, -2)
      node.setAttribute('no-bg', '')
      checkBackgroundSize(node, url)
    }

    // pseudo element
    for (const [url, dom, width, height] of pseudoImageDataList) {
      if (width >= minWidth && height >= minHeight) {
        imageDataList.push({src: url, dom})
      }
    }

    const uniqueDataList = processImageDataList(options, imageDataList)
    return uniqueDataList
  }

  // sort image list
  function getNodeRootList(node) {
    const collection = [node]
    let root = node.getRootNode()
    while (root !== document) {
      collection.push(root.host)
      root = root.host.getRootNode()
    }
    return collection
  }
  function compareRootPosition(a, b) {
    const aRootList = getNodeRootList(a)
    const bRootList = getNodeRootList(b)
    const minLength = Math.min(aRootList.length, bRootList.length)
    for (let i = 1; i <= minLength; i++) {
      const topA = aRootList[aRootList.length - i]
      const topB = bRootList[bRootList.length - i]
      if (topA !== topB) {
        return topA.compareDocumentPosition(topB) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      }
    }
  }
  function sortImageDataList(dataList) {
    return dataList.sort((a, b) => {
      const comparison = a.dom.compareDocumentPosition(b.dom)
      if (!(comparison & Node.DOCUMENT_POSITION_DISCONNECTED)) {
        return comparison & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      }
      if (a.dom.getRootNode({composed: true}) === document && b.dom.getRootNode({composed: true}) === document) {
        return compareRootPosition(a.dom, b.dom)
      }
      // node not attached to document
      return 0
    })
  }

  // image search
  function getDomUrl(dom) {
    const tag = dom.tagName
    if (tag === 'IMG') return dom.currentSrc || dom.src
    if (tag === 'VIDEO') return dom.poster
    const backgroundImage = window.getComputedStyle(dom).backgroundImage
    const bgList = backgroundImage.split(', ').filter(bg => bg.startsWith('url') && !bg.endsWith('.svg")'))
    return bgList.length !== 0 ? bgList[0].slice(5, -2) : ''
  }
  function removeRepeatNonRaw(newList, oldList) {
    const tempList = newList.concat(oldList)
    const tempImageUrlSet = new Set(tempList.map(data => data.src))
    for (const data of tempList) {
      const rawUrl = getRawUrl(data.src)
      if (data.src !== rawUrl && tempImageUrlSet.has(rawUrl)) tempImageUrlSet.delete(data.src)
    }

    for (const data of newList) {
      const url = data.src
      const rawUrl = getRawUrl(url)
      if (url !== rawUrl && tempImageUrlSet.has(rawUrl)) {
        data.src = rawUrl
      }
    }

    for (const data of oldList) {
      const url = data.src
      const rawUrl = getRawUrl(url)
      if (url !== rawUrl && tempImageUrlSet.has(rawUrl)) {
        data.src = rawUrl
      }
    }
  }
  function createImageIndexSearcher(srcList) {
    function searchIndex(src) {
      const index = srcIndexMap.get(src)
      if (index !== undefined) return index
      const rawIndex = srcIndexMap.get(getRawUrl(src))
      if (index !== undefined) return rawIndex
      const filename = getFilename(src)
      const filenameIndex = srcIndexMap.get(filename)
      if (filenameIndex !== undefined) return filenameIndex
      return -1
    }
    function updateCache(srcList) {
      for (let i = lastLength; i < srcList.length; i++) {
        srcIndexMap.set(srcList[i], i)
        // skip same filename
        const filename = getFilename(srcList[i])
        if (repeatFilename.has(filename) || srcIndexMap.has(filename)) {
          repeatFilename.add(filename)
          srcIndexMap.delete(filename)
        } else {
          srcIndexMap.set(filename, i)
        }
      }
      lastLength = srcList.length
    }

    // assumes previous src unchange
    let lastLength = 0
    const srcIndexMap = new Map()
    const repeatFilename = new Set()
    updateCache(srcList)

    return {
      searchIndex: searchIndex,
      updateCache: updateCache
    }
  }

  return {
    updateWrapperSize: function (dom, domSize, options) {
      if (!dom || dom.getRootNode({composed: true}) !== document) return

      const tagName = dom.tagName
      const [domWidth, domHeight] = domSize
      if (domWidth === 0) return

      // non image
      if (tagName !== 'IMG') {
        const selector = getDomSelector(dom)
        updateSizeBySelector(domWidth, domHeight, document.body, tagName, selector, options)
        return
      }

      // image
      const wrapper = dom.closest('div')
      const wrapperList = getWrapperList(wrapper)
      // wrapper is custom element, check all image in wrapper list
      if (wrapperList.length !== 0 && wrapperList[0].tagName.includes('-')) {
        updateSizeByWrapper(wrapperList, domWidth, domHeight, options)
        return
      }
      // no or single wrapper
      if (wrapperList.length <= 1) {
        const selector = getDomSelector(dom)
        updateSizeBySelector(domWidth, domHeight, document.body, 'IMG', selector, options)
        return
      }
      // wrapper is normal div
      if (wrapper.classList.length === 0) {
        updateSizeBySelector(domWidth, domHeight, wrapper, 'IMG', 'img', options)
        return
      }
      // check all image in wrapper list
      updateSizeByWrapper(wrapperList, domWidth, domHeight, options)
    },

    getOrderedImageList: async function (options, retryCount = 3) {
      if (retryCount === 0) return []

      await startUnlazy(options)

      const iframeImageList = await getIframeImageList(options)
      const imageList = getImageList(options)

      const uniqueImageList = iframeImageList.concat(imageList)
      if (uniqueImageList.length === 0) {
        console.log('Found no image')
        return this.getOrderedImageList(options, retryCount - 1)
      }

      scrollRelease()
      const orderedImageList = sortImageDataList(uniqueImageList)
      return orderedImageList
    },

    getOrderedCanvasList: async function (options) {
      const iframeCanvasList = await getIframeImageList(options)
      const canvasList = await getCanvasList(options)

      const uniqueCanvasList = iframeCanvasList.concat(canvasList)
      if (uniqueCanvasList.length === 0) {
        console.log('Found no image')
      }

      const orderedCanvasList = sortImageDataList(uniqueCanvasList)
      return orderedCanvasList
    },

    searchImageInfoIndex: function (input, imageList) {
      const src = input instanceof Element ? getDomUrl(input) : input
      const srcList = imageList.map(data => data.src)
      const searcher = createImageIndexSearcher(srcList)
      const index = searcher.searchIndex(src)
      return index
    },

    combineImageList: function (newList, oldList) {
      const imageFailureCountMap = ImageViewer('get_image_failure_count')
      oldList = oldList.filter(data => !badImageSet.has(data.src) && (imageFailureCountMap.get(data.src) === undefined || imageFailureCountMap.get(data.src) < 3))
      if (newList.length === 0 || oldList.length === 0) return newList.concat(oldList)

      removeRepeatNonRaw(newList, oldList)

      const combinedSrcList = new Array(newList.length + oldList.length)
      const combinedImageList = new Array(newList.length + oldList.length)

      const oldSearcher = createImageIndexSearcher(oldList.map(data => data.src))
      const combinedSearcher = createImageIndexSearcher([])

      let leftIndex = 0
      let rightIndex = 0
      let indexAtOldArray = -1
      let indexAtCombinedArray = -1
      let vacancyIndex = 0
      let oldArrayLastIndex = 0
      let distance = 0

      while (rightIndex < newList.length) {
        const right = newList[rightIndex]

        combinedSearcher.updateCache(combinedSrcList.slice(0, vacancyIndex))
        indexAtOldArray = oldSearcher.searchIndex(right.src)
        indexAtCombinedArray = combinedSearcher.searchIndex(right.src)

        // right is not a anchor
        if (indexAtOldArray === -1 || (indexAtOldArray !== -1 && indexAtCombinedArray !== -1)) {
          rightIndex++
          continue
        }

        // fill list with oldList (exclude right)
        distance = indexAtOldArray - oldArrayLastIndex
        for (let i = 0; i < distance; i++) {
          combinedSrcList[vacancyIndex] = oldList[oldArrayLastIndex].src
          combinedImageList[vacancyIndex++] = oldList[oldArrayLastIndex++]
        }

        // fill list with newList from left index to right index
        distance = rightIndex - leftIndex + 1
        for (let i = 0; i < distance; i++) {
          combinedSrcList[vacancyIndex] = newList[leftIndex].src
          combinedImageList[vacancyIndex++] = newList[leftIndex++]
        }
        rightIndex = leftIndex
        oldArrayLastIndex++
      }

      // fill list with remained oldList
      distance = oldList.length - oldArrayLastIndex
      for (let i = 0; i < distance; i++) {
        combinedSrcList[vacancyIndex] = oldList[oldArrayLastIndex].src
        combinedImageList[vacancyIndex++] = oldList[oldArrayLastIndex++]
      }

      // last element of newList is not a anchor
      if (indexAtOldArray === -1 || (indexAtOldArray !== -1 && indexAtCombinedArray !== -1)) {
        // fill list with remained newList
        distance = newList.length - leftIndex
        for (let i = 0; i < distance; i++) {
          combinedSrcList[vacancyIndex] = newList[leftIndex].src
          combinedImageList[vacancyIndex++] = newList[leftIndex++]
        }
      }

      const finalList = combinedImageList.filter(Boolean)

      const imageUrlSet = new Set()
      const uniqueFinalList = []
      for (const data of finalList) {
        const url = data.src
        if (!imageUrlSet.has(url)) {
          imageUrlSet.add(url)
          uniqueFinalList.push(data)
        }
      }

      const newSrcDomMap = new Map()
      for (const {src, dom} of newList) {
        if (dom.tagName !== 'IFRAME') {
          newSrcDomMap.set(src, dom)
        }
      }
      for (const data of uniqueFinalList) {
        const dom = newSrcDomMap.get(data.src)
        if (dom) data.dom = dom
      }

      return uniqueFinalList
    },

    isStrLengthEqual: function (newList, oldList) {
      const newListStringLength = newList.map(data => data.src.length).reduce((a, b) => a + b, 0)
      const oldListStringLength = oldList.map(data => data.src.length).reduce((a, b) => a + b, 0)
      return newListStringLength === oldListStringLength
    },

    getMainContainer: getMainContainer,

    getRawUrl: getRawUrl,

    getFilename: getFilename
  }
})()
