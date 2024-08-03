window.ImageViewerUtils = (function () {
  'use strict'

  const safeSendMessage = function (...args) {
    if (chrome.runtime?.id) {
      return chrome.runtime.sendMessage(...args)
    }
  }

  // attr unlazy
  const passList = new Set(['class', 'style', 'src', 'srcset', 'alt', 'title', 'loading', 'crossorigin', 'width', 'height', 'max-width', 'max-height', 'sizes', 'onerror', 'data-error'])
  const urlRegex = /(?:https?:\/)?\/\S+/g
  const protocol = location.protocol
  const origin = location.origin + '/'
  const srcBitSizeMap = new Map()
  const srcRealSizeMap = new Map()
  const badImageSet = new Set(['', 'about:blank'])
  const corsHostSet = new Set()
  const semaphore = (() => {
    // parallel fetch
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
          if (queue.length > 0) {
            const grantAccess = queue.shift()
            grantAccess()
          }
        }

        if (activeCount < maxConcurrent) {
          activeCount++
          return release
        }
        return new Promise(resolve => {
          const grantAccess = () => {
            activeCount++
            resolve(release)
          }
          queue.push(grantAccess)
        })
      }
    }
  })()

  // unlazy state
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
  unlazyObserver.observe(document.documentElement, {attributes: true, subtree: true, attributeFilter: ['src', 'srcset']})

  // init observer for node background being modify
  const styleObserver = new MutationObserver(mutationsList => {
    for (const mutation of mutationsList) {
      mutation.target.removeAttribute('no-bg')
      mutation.target.removeAttribute('data-bg')
      mutation.target.removeAttribute('data-width')
      mutation.target.removeAttribute('data-height')
    }
  })
  styleObserver.observe(document.documentElement, {attributes: true, subtree: true, attributeFilter: ['style']})

  //==========utility==========
  function checkKey(e, hotkey) {
    const keyList = hotkey.split('+').map(str => str.trim())
    const key = keyList[keyList.length - 1] === e.key.toUpperCase()
    const ctrl = keyList.includes('Ctrl') === e.ctrlKey
    const alt = keyList.includes('Alt') === e.altKey || e.getModifierState('AltGraph')
    const shift = keyList.includes('Shift') === e.shiftKey
    return key && ctrl && alt && shift
  }

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
      if (src.startsWith('data')) return src

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
  const getPathname = (function () {
    const pathnameCache = new Map()
    return src => {
      const cache = pathnameCache.get(src)
      if (cache !== undefined) return cache

      try {
        const url = new URL(src, document.baseURI)
        const pathname = url.pathname.split('.')[0]
        pathnameCache.set(src, pathname)
        return pathname
      } catch (error) {
        pathnameCache.set(src, null)
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

  function isLazyClass(className) {
    if (className === '') return false
    const lower = className.toLowerCase()
    return lower.includes('lazy') || lower.includes('loading')
  }
  function isImageViewerExist() {
    return document.documentElement.classList.contains('has-image-viewer')
  }
  function isPromiseComplete(promise) {
    const symbol = Symbol('check')
    const signal = new Promise(resolve => setTimeout(resolve, 0, symbol))
    return Promise.race([promise, signal]).then(result => result !== symbol)
  }

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

  function getDomUrl(dom) {
    const tag = dom.tagName
    if (tag === 'IMG') return dom.currentSrc || dom.src
    if (tag === 'VIDEO') return dom.poster
    const backgroundImage = window.getComputedStyle(dom).backgroundImage
    const bgList = backgroundImage.split(', ').filter(bg => bg.startsWith('url') && !bg.endsWith('.svg")'))
    return bgList.length !== 0 ? bgList[0].slice(5, -2) : ''
  }
  function getImageIndexSearcher(srcList) {
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

  // wrapper size
  function checkMatchSize(rawWidth, rawHeight) {
    // below value should close to real img container size
    const rawWidthMax = Math.max(...rawWidth) - 5
    const rawHeightMax = Math.max(...rawHeight) - 5
    let flag = true
    for (let i = 0; i < rawWidth.length; i++) {
      flag &&= rawWidth[i] >= rawWidthMax || rawHeight[i] >= rawHeightMax
    }
    return flag
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
      imageCountList.push(imgList.length)
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
    const maxImageCount = Math.max(...imageCountList)
    const imageCount = imageCountList.reduce((a, b) => a + b, 0)

    const largeContainerCount = imageCountList.filter(num => num === maxImageCount).length
    const isLargeContainer = maxImageCount >= 5 && wrapperList.length - largeContainerCount < 3
    const isOneToOne = !isLargeContainer && imageCount === wrapperList.length
    const isMatchSize = isOneToOne && checkMatchSize(rawWidth, rawHeight)
    const useMinSize = isLargeContainer || isMatchSize

    const getMinSize = rawSizeList => Math.min(...rawSizeList.filter(Boolean))
    const getRefSize = (sizeList, domSize, optionSize) => Math.min(...sizeList.filter(s => s * 1.5 >= domSize || s * 1.2 >= optionSize))

    // treat long size as width
    const [large, small] = domWidth > domHeight ? [domWidth, domHeight] : [domHeight, domWidth]
    const [optionLarge, optionSmall] = options.minWidth > options.minHeight ? [options.minWidth, options.minHeight] : [options.minHeight, options.minWidth]
    const finalWidth = useMinSize ? getMinSize(rawWidth) : getRefSize(wrapperWidth, large, optionLarge)
    const finalHeight = useMinSize ? getMinSize(rawHeight) : getRefSize(wrapperHeight, small, optionSmall)

    // not allow size below 50 to prevent icon
    const finalSize = Math.max(useMinSize ? 0 : 50, Math.min(finalWidth, finalHeight)) - 3
    options.minWidth = Math.min(finalSize, options.minWidth)
    options.minHeight = Math.min(finalSize, options.minHeight)
  }

  function getWrapperList(wrapper) {
    if (!wrapper) return []
    const rootNode = wrapper.getRootNode()
    if (rootNode !== document) return deepQuerySelectorAll(document.body, rootNode.host.tagName.toUpperCase(), rootNode.host.tagName)
    const classList = wrapper ? '.' + [...wrapper?.classList].map(CSS.escape).join(', .') : ''
    const wrapperList = wrapper ? document.querySelectorAll(`div:is(${classList}):has(img):not(:has(div img))`) : []
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

    let [minWidth, minHeight] = domWidth > domHeight ? [domWidth, domHeight] : [domHeight, domWidth]
    for (const dom of targetDom) {
      const {width, height} = dom.getBoundingClientRect()
      if (width === 0 || height === 0) continue
      const [large, small] = width > height ? [width, height] : [height, width]
      if (large * 1.5 >= minWidth && small * 1.5 > minHeight) {
        minWidth = Math.min(domWidth, large)
        minHeight = Math.min(domWidth, small)
      }
    }
    options.minWidth = Math.min(minWidth - 3, options.minWidth)
    options.minHeight = Math.min(minHeight - 3, options.minHeight)
  }

  // scroll unlazy
  async function slowScrollThoughDocument(currentX, currentY) {
    if (!isImageViewerExist()) return
    const container = getMainContainer()
    const totalHeight = container.scrollHeight
    let currTop = -1
    container.scrollTo(0, 0)
    while (currTop !== container.scrollTop && currTop < totalHeight * 3 && isImageViewerExist()) {
      currTop = container.scrollTop
      container.scrollBy({top: window.innerHeight * 2, behavior: 'smooth'})
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    if (isImageViewerExist()) container.scrollTo(currentX, currentY)
  }
  function scrollThoughDocument(currentX, currentY) {
    const wrapper = (func, ...args) => {
      if (isImageViewerExist()) func(...args)
    }
    const container = getMainContainer()
    const scrollTo = container.scrollTo.bind(container)
    const totalHeight = container.scrollHeight
    const scrollDelta = window.innerHeight * 1.5
    let scrollCount = 0
    let top = 0
    while (top < totalHeight) {
      const currTop = top
      setTimeout(() => wrapper(scrollTo, currentX, currTop), ++scrollCount * 150)
      top += scrollDelta
    }
    setTimeout(() => wrapper(scrollTo, currentX, totalHeight), ++scrollCount * 150)
    setTimeout(() => wrapper(scrollTo, currentX, currentY), ++scrollCount * 150)
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
    scrollObserver.observe(document.documentElement, {
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
      let currBottom = 0
      let bottomImg = null
      for (const img of document.getElementsByTagName('img')) {
        const scrollBottom = img.getAttribute('scroll-bottom')
        const bottom = scrollBottom ? Number(scrollBottom) : img.getBoundingClientRect().bottom + scrollY
        img.setAttribute('scroll-bottom', bottom)
        if (bottom > currBottom) {
          currBottom = bottom
          bottomImg = img
        }
      }
      bottomImg.scrollIntoView({behavior: 'instant', block: 'start'})
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
        while (notStarted || notComplete) {
          await new Promise(resolve => (scrollRelease = resolve))
          const newImageCount = ImageViewer('get_image_list').length
          notStarted = lastImageCount === currentImageCount
          notComplete = currentImageCount !== newImageCount
          currentImageCount = newImageCount
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
          container.scrollBy(0, -100)
          container.scrollBy({top: window.innerHeight})
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
    imageViewerObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['class']})
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
    newNodeObserver.observe(document.documentElement, {childList: true, subtree: true})
    setTimeout(() => {
      if (!existNewDom || imageListLength === ImageViewer('get_image_list').length) {
        const container = getMainContainer()
        const totalHeight = container.scrollHeight
        container.scrollTo(startX, totalHeight)
      }
    }, 3000)

    stopAutoScrollOnExit(newNodeObserver, startX, startY)
  }

  // attr unlazy
  async function waitSrcUpdate(img) {
    const srcUrl = new URL(img.src, document.baseURI)
    while (srcUrl.href !== img.currentSrc) {
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  async function updateImageSource(img, src) {
    const release = await semaphore.acquire()
    // get cache to disk
    const success = await new Promise(resolve => {
      const temp = new Image()
      temp.onload = () => resolve(true)
      temp.onerror = () => resolve(false)
      setTimeout(() => resolve(false), 5000)
      temp.loading = 'eager'
      temp.referrerPolicy = img.referrerPolicy
      temp.src = src
    })
    release()
    if (!success) return false

    img.src = src
    img.srcset = src
    const picture = img.parentNode
    if (picture?.tagName === 'PICTURE') {
      for (const source of picture.querySelectorAll('source')) {
        source.srcset = src
      }
    }
    await waitSrcUpdate(img)
    return true
  }
  async function fetchBitSize(url) {
    if (corsHostSet.has(url.hostname)) return 0

    const release = await semaphore.acquire()
    try {
      const res = await fetch(url.href, {method: 'HEAD', signal: AbortSignal.timeout(5000)})
      if (!res.ok) return 0
      if (res.redirected) return -1
      const type = res.headers.get('Content-Type')
      const length = res.headers.get('Content-Length')
      if (type?.startsWith('image') || (type === 'application/octet-stream' && cachedExtensionMatch(url.href))) {
        const size = Number(length)
        return size
      }
      return 0
    } catch (error) {
      if (error.name !== 'TimeoutError') corsHostSet.add(url.hostname)
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
      fetchBitSize(url).then(updateSize)
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
      setTimeout(() => resolve(0), 10000)
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
        const attr = attrList[lastIndex++]
        complete = lastIndex === attrList.length
        const newURL = attr.value.replace(/https?:/, protocol).replace(/^\/(?:[^/])/, origin)
        const betterUrl = await getBetterUrl(currentSrc, bitSize, naturalSize, newURL)
        if (betterUrl === null) continue
        const success = await updateImageSource(img, betterUrl)
        if (success) {
          const realAttrName = attr.name.startsWith('raw ') ? attr.name.slice(4) : attr.name
          img.removeAttribute(realAttrName)
          successList.push(attr.name)
          badImageSet.add(currentSrc)
          break
        }
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
    const src = img.currentSrc
    const rawUrl = getRawUrl(src)
    const attrList = []
    for (const attr of img.attributes) {
      if (passList.has(attr.name) || !attr.value.match(urlRegex)) continue

      const attrUrl = new URL(attr.value, document.baseURI).href
      if (attrUrl !== src) {
        attrList.push({name: attr.name, value: attrUrl})
      }
      const rawAttrUrl = getRawUrl(attrUrl)
      if (rawAttrUrl !== attrUrl && rawAttrUrl !== rawUrl) {
        attrList.push({name: 'raw ' + attr.name, value: rawAttrUrl})
      }
    }
    if (img.srcset && img.srcset !== src) {
      const srcsetList = img.srcset
        .split(',')
        .map(str => str.trim().split(/ +/))
        .map(([url, size]) => [url, size ? Number(size.slice(0, -1)) : 1])
        .sort((a, b) => b[1] - a[1])
      attrList.push({name: 'srcset', value: srcsetList[0][0]})
    }
    if (rawUrl !== src) {
      attrList.push({name: 'raw url', value: rawUrl})
    }
    try {
      const url = new URL(src, document.baseURI)
      const pathname = url.pathname
      const search = url.search
      if (pathname.match(/[-_]thumb(?=nail)?\./)) {
        const nonThumbnailPath = pathname.replace(/[-_]thumb(?=nail)?\./, '.')
        const nonThumbnail = src.replace(pathname, nonThumbnailPath)
        attrList.push({name: 'non thumbnail path', value: nonThumbnail})
      }

      if (!src.includes('?')) throw new Error()

      if (!pathname.includes('.')) {
        const extMatch = search.match(/jpeg|jpg|png|gif|webp|bmp|tiff|avif/)
        if (extMatch) {
          const filenameWithExt = pathname + '.' + extMatch[0]
          const rawExtension = src.replace(pathname + search, filenameWithExt)
          attrList.push({name: 'raw extension', value: rawExtension})
        }
      }
      if (search.includes('width=') || search.includes('height=')) {
        const noSizeQuery = search.replace(/&?width=\d+|&?height=\d+/g, '')
        const rawQuery = src.replace(search, noSizeQuery)
        attrList.push({name: 'no size query', value: rawQuery})
      }
      const noQuery = src.replace(pathname + search, pathname)
      attrList.push({name: 'no query', value: noQuery})
    } catch (error) {}
    const anchor = img.closest('a')
    if (anchor && anchor.href !== src && anchor.href.match(urlRegex)) {
      const anchorHaveExt = cachedExtensionMatch(anchor.href) !== null
      const rawHaveExt = cachedExtensionMatch(rawUrl) !== null
      const maybeLarger = anchorHaveExt || anchorHaveExt === rawHaveExt || rawUrl.slice(0, 12).includes('cdn.')
      if (maybeLarger) attrList.push({name: 'parent anchor', value: anchor.href})
    }
    return attrList.filter(attr => attr.value !== src)
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

    const resultList = await Promise.all(asyncList)
    const lazyList = resultList.flat()
    if (lazyList.length > resultList.listSize) console.log('Multiple unlazy attributes found')
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
  function preprocessLazyPlaceholder() {
    const lazySrcList = [...document.getElementsByTagName('img')].filter(image => isLazyClass(image.className) && image.src).map(image => image.currentSrc.replace(/https?:/, protocol))
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
    for (const image of document.getElementsByTagName('img')) {
      image.dispatchEvent(enterEvent)
      image.dispatchEvent(overEvent)
      image.dispatchEvent(leaveEvent)
    }
  }
  function setAutoScrollSetting(options) {
    const domainList = []
    const regexList = []
    for (const str of options.autoScrollEnableList) {
      if (str[0] === '/' && str[str.length - 1] === '/') {
        regexList.push(new RegExp(str.slice(1, -1)))
      } else {
        domainList.push(str)
      }
    }
    enableAutoScroll = domainList.some(domain => domain === location.hostname || domain === location.hostname.replace('www.', ''))
    enableAutoScroll ||= regexList.some(regex => regex.test(location.href))
  }
  function startUnlazy(options) {
    if (lastUnlazyTask === null) {
      preprocessLazyPlaceholder()
      fakeUserHover()
      setAutoScrollSetting(options)
    }
    if (lastHref !== '' && lastHref !== location.href) {
      const allImageOnPage = new Set(getImageListWithoutFilter(options).map(data => data.src))
      const unchangedCount = new Set(window.backupImageList).intersection(allImageOnPage).size
      if (unchangedCount < 5) {
        unlazyFlag = false
        lastUnlazyTask = null
        window.backupImageList = []
        ImageViewer('reset_image_list')
      }
    }
    lastHref = location.href
    const race = createUnlazyRace(options)
    return race
  }

  // get image
  async function getIframeImageList(options) {
    const iframeList = deepQuerySelectorAll(document.body, 'IFRAME', 'iframe')
    const iframeSrcList = iframeList.map(iframe => iframe.src)
    const filteredList = iframeSrcList.filter(src => src !== '' && src !== 'about:blank')
    if (filteredList.length === 0) return []

    const minSize = Math.min(options.minWidth, options.minHeight)
    const iframeImage = (await safeSendMessage({msg: 'extract_frames', minSize: minSize})) || []
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
    return imageDataList
  }
  function processImageDataList(options, imageDataList) {
    const isBadImage = options.svgFilter ? url => badImageSet.has(url) || url.startsWith('data:image/svg') || url.includes('.svg') : url => badImageSet.has(url)

    const filteredDataList = imageDataList.filter(data => !isBadImage(data.src))

    const urlDataMap = new Map()
    const rawUrlConnection = new Map()
    const pathnameConnection = new Map()
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

      // build connection between url and pathname
      const pathname = getPathname(rawUrl)
      if (pathname !== null && src !== pathname) {
        const connection = pathnameConnection.get(pathname)
        if (connection === undefined) pathnameConnection.set(pathname, [src])
        else if (connection instanceof Array) connection.push(src)
      }

      const cache = urlDataMap.get(src)
      if (cache === undefined) urlDataMap.set(src, data)
      else if (cache.dom.tagName !== 'IMG' && data.dom.tagName === 'IMG') urlDataMap.set(src, data)
    }

    // remove same pathname
    for (const connectionList of pathnameConnection.values()) {
      const connection = [...new Set(connectionList)]
      const length = connection.length
      // likely be get/resize image endpoint if more than 3
      if (length === 2 || length === 3) {
        const cacheIndexList = connection.map((url, index) => [urlDataMap.get(url), index]).filter(([cache, index]) => cache !== undefined)
        const firstIndex = cacheIndexList.findIndex(([cache, index]) => cache.dom.tagName === 'IMG') || cacheIndexList[0][1]
        connection.filter((url, index) => index !== firstIndex).forEach(url => urlDataMap.delete(url))
      }
    }

    const uniqueDataList = Array.from(urlDataMap, ([k, v]) => v)
    return uniqueDataList
  }
  function getImageListWithoutFilter(options) {
    const imageDataList = []

    const rawImageList = deepQuerySelectorAll(document.body, 'IMG', 'img[iv-image]')
    for (const img of rawImageList) {
      const imgSrc = img.currentSrc || img.src
      imageDataList.push({src: imgSrc, dom: img})
    }

    const videoList = document.querySelectorAll('video[poster]')
    for (const video of videoList) {
      imageDataList.push({src: video.poster, dom: video})
    }

    const uncheckedNodeList = document.body.querySelectorAll('*:not([no-bg]):not([iv-image]):not(video[poster])')
    for (const node of uncheckedNodeList) {
      const attrUrl = node.getAttribute('data-bg')
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
        node.setAttribute('data-bg', url)
        imageDataList.push({src: url, dom: node})
      }
    }

    const uniqueDataList = processImageDataList(options, imageDataList)
    return uniqueDataList
  }
  async function checkRepeatBackground(url, node) {
    const realSize = await getImageRealSize(url)
    node.setAttribute('data-width', realSize)
    node.setAttribute('data-height', realSize)
  }
  function isNodeSizeEnough(node, minWidth, minHeight) {
    const widthAttr = node.getAttribute('data-width')
    const heightAttr = node.getAttribute('data-height')
    if (widthAttr && heightAttr) {
      const width = Number(widthAttr)
      const height = Number(heightAttr)
      return width >= minWidth && height >= minHeight
    }
    const {width, height} = node.getBoundingClientRect()
    if (width === 0 || height === 0) {
      node.setAttribute('no-bg', '')
      return false
    }
    node.setAttribute('data-width', width)
    node.setAttribute('data-height', height)
    return width >= minWidth && height >= minHeight
  }
  function getImageList(options) {
    const minWidth = options.minWidth
    const minHeight = options.minHeight
    if (minWidth === 0 && minHeight === 0) {
      return getImageListWithoutFilter(options)
    }

    const imageDataList = []

    const rawImageList = deepQuerySelectorAll(document.body, 'IMG', 'img[iv-image]')
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

    const uncheckedNodeList = document.body.querySelectorAll('*:not([no-bg]):not([iv-image]):not(video[poster])')
    for (const node of uncheckedNodeList) {
      if (!isNodeSizeEnough(node, minWidth, minHeight)) continue
      const attrUrl = node.getAttribute('data-bg')
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
      node.setAttribute('data-bg', url)
      if (nodeStyle.backgroundRepeat === 'repeat') {
        node.setAttribute('data-width', 0)
        node.setAttribute('data-height', 0)
        checkRepeatBackground(url, node)
      } else {
        imageDataList.push({src: url, dom: node})
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

  // combine image list
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

  return {
    updateWrapperSize: function (dom, domSize, options) {
      if (!dom || dom.getRootNode({composed: true}) !== document) return

      const tagName = dom.tagName
      if (tagName !== 'IMG' && tagName !== 'DIV') {
        options.sizeCheck = true
        return
      }
      const [domWidth, domHeight] = domSize
      if (domWidth === 0) return

      // div
      if (tagName === 'DIV') {
        const selector = getDomSelector(dom)
        updateSizeBySelector(domWidth, domHeight, document.body, 'DIV', selector, options)
        return
      }

      // image
      const wrapper = dom.closest('div')
      const wrapperList = getWrapperList(wrapper)
      // no or single wrapper
      if (wrapperList.length <= 1) {
        const selector = getDomSelector(dom)
        updateSizeBySelector(domWidth, domHeight, document.body, 'IMG', selector, options)
        return
      }
      // wrapper is custom element, check all image in wrapper list
      if (wrapperList[0].tagName.includes('-')) {
        updateSizeByWrapper(wrapperList, domWidth, domHeight, options)
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

    getOrderedImageList: async function (options) {
      await startUnlazy(options)

      const iframeImageList = await getIframeImageList(options)
      const imageList = getImageList(options)

      const uniqueImageList = iframeImageList.concat(imageList)
      if (uniqueImageList.length === 0) {
        console.log('Found no image')
      }

      scrollRelease()
      const orderedImageList = sortImageDataList(uniqueImageList)
      return orderedImageList
    },

    searchImageInfoIndex: function (input, imageList) {
      const srcList = imageList.map(data => data.src)
      const src = input instanceof Element ? getDomUrl(input) : input
      const searcher = getImageIndexSearcher(srcList)
      const index = searcher.searchIndex(src)
      return index
    },

    combineImageList: function (newList, oldList) {
      oldList = oldList.filter(data => !badImageSet.has(data.src))
      if (newList.length === 0 || oldList.length === 0) return newList.concat(oldList)

      removeRepeatNonRaw(newList, oldList)

      const combinedImageList = new Array(newList.length + oldList.length)

      const oldSearcher = getImageIndexSearcher(oldList.map(data => data.src))
      const combinedSearcher = getImageIndexSearcher([])

      let leftIndex = 0
      let rightIndex = 0
      let indexAtOldArray = -1
      let indexAtCombinedArray = -1
      let vacancyIndex = 0
      let oldArrayLastIndex = 0
      let distance = 0

      while (rightIndex < newList.length) {
        const right = newList[rightIndex]

        const combinedSrcList = combinedImageList.filter(Boolean).map(data => data.src)
        combinedSearcher.updateCache(combinedSrcList)
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
          combinedImageList[vacancyIndex++] = oldList[oldArrayLastIndex++]
        }

        // fill list with newList from left index to right index
        distance = rightIndex - leftIndex + 1
        for (let i = 0; i < distance; i++) {
          combinedImageList[vacancyIndex++] = newList[leftIndex++]
        }
        rightIndex = leftIndex
        oldArrayLastIndex++
      }

      // fill list with remained oldList
      distance = oldList.length - oldArrayLastIndex
      for (let i = 0; i < distance; i++) {
        combinedImageList[vacancyIndex++] = oldList[oldArrayLastIndex++]
      }

      // last element of newList is not a anchor
      if (indexAtOldArray === -1 || (indexAtOldArray !== -1 && indexAtCombinedArray !== -1)) {
        // fill list with remained newList
        distance = newList.length - leftIndex
        for (let i = 0; i < distance; i++) {
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
      for (const data of newList) {
        newSrcDomMap.set(data.src, data.dom)
      }
      for (const data of uniqueFinalList) {
        const dom = newSrcDomMap.get(data.src)
        if (dom) data.dom = dom
      }

      const orderedFinalList = sortImageDataList(uniqueFinalList)
      return orderedFinalList
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
