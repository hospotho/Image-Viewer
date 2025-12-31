window.ImageViewerUtils = (function () {
  'use strict'

  const safeSendMessage = function (...args) {
    if (chrome.runtime?.id) {
      return chrome.runtime.sendMessage(...args)
    }
  }

  // parallel fetch
  const semaphore = (() => {
    const maxConcurrent = 32
    const fastQueue = []
    const normalQueue = []
    let fastCount = 0
    let normalCount = 0
    let processFlag = false
    let slowAlertFlag = false
    return {
      acquire: function (highPriority = false) {
        let executed = false
        let slowTimeout = 0
        const release = () => {
          if (executed) return
          executed = true
          fastCount -= highPriority ? 1 : 0
          normalCount -= highPriority ? 0 : 1
          clearTimeout(slowTimeout)

          // check fast queue
          const fastAccess = fastQueue.shift()
          if (fastAccess) {
            fastAccess()
            return
          }

          // wait until all fast tasks complete
          if (fastCount > 0 || fastQueue.length > 0) {
            this.process()
            return
          }
          const grantAccess = normalQueue.shift()
          if (grantAccess) grantAccess()
        }

        // check availability
        const isAvailable = (highPriority && fastCount + normalCount < maxConcurrent) || (fastCount === 0 && normalCount < maxConcurrent)
        if (isAvailable) {
          fastCount += highPriority ? 1 : 0
          normalCount += highPriority ? 0 : 1
          slowTimeout = setTimeout(this.slowAlert, 200 * maxConcurrent)
          return release
        }

        // create ticket
        const {promise, resolve} = Promise.withResolvers()
        const grantAccess = () => {
          fastCount += highPriority ? 1 : 0
          normalCount += highPriority ? 0 : 1
          slowTimeout = setTimeout(this.slowAlert, 200 * maxConcurrent)
          resolve(release)
        }
        const targetQueue = highPriority ? fastQueue : normalQueue
        targetQueue.push(grantAccess)
        return promise
      },
      process: async function () {
        if (processFlag) return
        processFlag = true
        while (true) {
          if (fastCount === 0 && fastQueue.length === 0) break
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        normalQueue.splice(0, maxConcurrent - normalCount).map(grantAccess => grantAccess())
        processFlag = false
      },
      slowAlert: function () {
        if (slowAlertFlag) return
        slowAlertFlag = true
        console.log('Slow connection, images still loading')
        alert('Slow connection, images still loading')
      }
    }
  })()

  // attr unlazy
  const attrWhiteList = new Set([
    'class',
    'style',
    'src',
    'srcset',
    'alt',
    'title',
    'loading',
    'crossorigin',
    'width',
    'height',
    'max-width',
    'max-height',
    'iv-width',
    'iv-height',
    'sizes',
    'onload',
    'onerror',
    'data-error',
    'iv-image',
    'iv-bg',
    'no-bg',
    'no-shadow'
  ])
  const urlRegex = /(?:^| |https?:\/)\/\S+/g
  const protocol = location.protocol
  const origin = location.origin + '/'
  const symbol = Symbol('check')
  const signal = Promise.resolve(symbol)
  const pendingBadImageMap = new Map()

  // image cache
  window.backupImageList = []
  window.badImageSet ??= new Set(['', 'about:blank'])
  window.corsHostSet ??= new Set()
  window.srcBitSizeMap ??= new Map()
  window.srcRealSizeMap ??= new Map()
  const badImageSet = window.badImageSet
  const corsHostSet = window.corsHostSet
  const srcBitSizeMap = window.srcBitSizeMap
  const srcRealSizeMap = window.srcRealSizeMap

  // unlazy state
  const pseudoImageDataList = []
  let lastHref = location.href
  let disableImageUnlazy = false
  let unlazyFlag = false
  let lastUnlazyTask = null
  let lastIframeCanvasTask = null
  let lastIframeImageTask = null

  // scroll state
  let viewerMoveToFlag = false
  let enableAutoScroll = false
  let scrollUnlazyFlag = false
  let autoScrollFlag = false
  let scrollRelease = () => {}
  document.addEventListener('iv-moveto', () => (viewerMoveToFlag = true))

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

  // init observer for href change
  const hrefObserver = new MutationObserver(async () => {
    if (lastHref === location.href) return
    lastHref = location.href

    // check image update
    const viewerExist = isImageViewerExist()
    const {promise, resolve} = Promise.withResolvers()
    const backupImageSrc = new Set(window.backupImageList.map(data => data.src))
    const checkImageUpdate = () => {
      const allImageSrc = new Set(getImageListWithoutFilter().map(data => data.src))
      if (allImageSrc.intersection(backupImageSrc).size < 5) {
        if (viewerExist) ImageViewer('close_image_viewer')
        resolve()
      }
    }

    // setup observer
    let timeout = 0
    const currentHref = location.href
    const observer = new MutationObserver(() => {
      clearTimeout(timeout)
      if (currentHref !== location.href) resolve()
      else timeout = setTimeout(checkImageUpdate, 100)
    })
    observer.observe(document.body, {childList: true, subtree: true})
    await waitPromiseComplete(promise, 2000)
    observer.disconnect()
  })
  hrefObserver.observe(document.body, {childList: true, subtree: true})

  // init observer for unlazy image being modify
  const unlazyObserver = new MutationObserver(mutationsList => {
    const modifiedSet = new Set()
    for (const mutation of mutationsList) {
      const element = mutation.target
      if (element.hasAttribute('iv-observing')) continue
      if (element.hasAttribute('iv-image') && !element.hasAttribute('iv-checking')) {
        modifiedSet.add(element)
      }
    }
    modifiedSet.forEach(async img => {
      while (!img.complete) {
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      const attrList = getUnlazyAttrList(img)
      if (attrList.length === 0) return
      img.setAttribute('iv-observing', '')
      await checkImageAttr(img, attrList)
      img.removeAttribute('iv-observing')
    })
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
  const cachedGetUrl = (function () {
    const srcUrlCache = new Map()
    return src => {
      const cache = srcUrlCache.get(src)
      if (cache !== undefined) return cache
      try {
        const url = new URL(src, document.baseURI)
        srcUrlCache.set(src, url)
        return url
      } catch (error) {
        srcUrlCache.set(src, null)
        return null
      }
    }
  })()
  const cachedExtensionMatch = (function () {
    const extensionRegex = /(.*?[=.](?:jpeg|jpg|png|gif|webp|bmp|tiff|avif))/i
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
      if (src.startsWith('data')) return null

      const cache = urlSearchCache.get(src)
      if (cache !== undefined) return cache

      // protocol-relative URL
      const url = cachedGetUrl(src)
      if (url === null) {
        urlSearchCache.set(src, null)
        return null
      }
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
  const cachedGetProxySrc = (function () {
    const proxyUrlCache = new Map()
    return (url, regex) => {
      const cache = proxyUrlCache.get(url.href)
      if (cache !== undefined) return cache

      const pathProxyMatch = url.pathname.slice(1).match(regex)
      if (pathProxyMatch) {
        const proxy = pathProxyMatch[0] + url.search
        proxyUrlCache.set(url.href, proxy)
        return proxy
      }

      const searchProxyMatch = url.search.match(regex)
      if (searchProxyMatch) {
        const subUrl = searchProxyMatch[0]
        const proxy = subUrl.includes('?') || subUrl.indexOf('&') === -1 ? subUrl : subUrl.slice(0, subUrl.indexOf('&'))
        proxyUrlCache.set(url.href, proxy)
        return proxy
      }

      return null
    }
  })()
  const cachedDeepDecode = (function () {
    const decodeCache = new Map()
    return _src => {
      const cache = decodeCache.get(_src)
      if (cache !== undefined) return cache

      let src = _src
      while (true) {
        try {
          const decoded = decodeURIComponent(src)
          if (src === decoded) break
          src = decoded
        } catch (e) {
          break
        }
      }

      decodeCache.set(_src, src)
      return src
    }
  })()
  const getRawUrl = (function () {
    const rawUrlCache = new Map()
    return src => {
      if (src.startsWith('data') || src.startsWith('blob')) return src

      const cache = rawUrlCache.get(src)
      if (cache !== undefined) return cache

      // always check decode
      src = cachedDeepDecode(src)

      // invalid URL
      const url = cachedGetUrl(src, document.baseURI)
      if (url === null) {
        rawUrlCache.set(src, src)
        return src
      }

      // proxy URL
      const proxy = cachedGetProxySrc(url, urlRegex)
      if (proxy) {
        const rawUrl = getRawUrl(proxy)
        rawUrlCache.set(src, rawUrl)
        return rawUrl
      }

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

      const fullPath = url.pathname + url.search
      const extensionMatch = cachedExtensionMatch(fullPath)
      const rawExtensionUrl = extensionMatch?.[1]
      if (rawExtensionUrl && rawExtensionUrl !== fullPath) {
        const rawExtensionFullUrl = url.origin + rawExtensionUrl
        rawUrlCache.set(src, rawExtensionFullUrl)
        return rawExtensionFullUrl
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

      // always check decode
      src = cachedDeepDecode(src)

      // invalid URL
      const url = cachedGetUrl(src)
      if (url === null) {
        pathIdCache.set(src, null)
        return null
      }

      // proxy URL
      const proxy = cachedGetProxySrc(url, urlRegex)
      if (proxy) {
        const pathId = getPathIdentifier(proxy)
        pathIdCache.set(src, pathId)
        return pathId
      }

      // simple file check
      if (url.search === '') {
        const pathId = url.pathname + url.hash
        pathIdCache.set(src, pathId)
        return pathId
      }

      // longest query check
      const dotIndex = url.pathname.lastIndexOf('.')
      const slashIndex = url.pathname.lastIndexOf('/')
      const pathname = dotIndex !== -1 && dotIndex > slashIndex ? url.pathname.slice(0, dotIndex) : url.pathname
      const query = url.search
        .split('&')
        .filter(attr => attr.split('=').at(-1).length > 6)
        .reduce((last, curr) => (curr.length > last.length ? curr : last), '')
      const pathId = pathname + query
      pathIdCache.set(src, pathId)
      return pathId
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
    const exist = document.body.classList.contains('iv-attached')
    if (exist) viewerMoveToFlag = false
    return exist
  }
  function isLazyClass(className) {
    if (className === '') return false
    const lower = className.toLowerCase()
    return lower.includes('lazy') || lower.includes('loading')
  }
  function isPromiseComplete(promise) {
    return Promise.race([promise, signal]).then(result => result !== symbol)
  }
  async function waitPromiseComplete(promise, maxWait) {
    await Promise.race([promise, new Promise(resolve => setTimeout(resolve, maxWait))])
    return isPromiseComplete(promise)
  }

  // dom search
  function deepQuerySelectorAll(target, selector) {
    const result = []
    const stack = [target]
    const visited = []
    while (stack.length) {
      const current = stack.shift()
      // check shadowRoot
      for (const node of current.querySelectorAll('*:not([no-shadow])')) {
        if (node.shadowRoot) {
          stack.push(node.shadowRoot)
        } else {
          visited.push(node)
        }
      }
      result.push(...current.querySelectorAll(selector))
    }
    for (const node of visited) {
      node.setAttribute('no-shadow', '')
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
  const cachedGetRootNode = (function () {
    const rootNodeMap = new WeakMap()
    const composedRootNodeMap = new WeakMap()
    return (node, composed = false) => {
      if (!node) return document
      const cache = composed ? composedRootNodeMap.get(node) : rootNodeMap.get(node)
      if (cache !== undefined) return cache

      if (composed) {
        const root = node.getRootNode({composed: true})
        composedRootNodeMap.set(node, root)
        return root
      }
      const root = node.getRootNode()
      rootNodeMap.set(node, root)
      return root
    }
  })()
  const cachedGetNodeRootList = (function () {
    const nodeRootListMap = new WeakMap()
    return node => {
      const cache = nodeRootListMap.get(node)
      if (cache !== undefined) return cache

      const collection = [node]
      let root = cachedGetRootNode(node)
      while (root !== document && root.host) {
        collection.push(root.host)
        root = cachedGetRootNode(root.host)
      }
      nodeRootListMap.set(node, collection)
      return collection
    }
  })()
  const getNodeId = (function () {
    const nodeIdMap = new WeakMap()
    let nodeIdCounter = 0
    return node => {
      const cache = nodeIdMap.get(node)
      if (cache !== undefined) return cache
      nodeIdMap.set(node, nodeIdCounter)
      return nodeIdCounter++
    }
  })()
  const cachedCompareRootPosition = (function () {
    function compareRootPosition(a, b) {
      const aRootList = cachedGetNodeRootList(a)
      const bRootList = cachedGetNodeRootList(b)
      const minLength = Math.min(aRootList.length, bRootList.length)
      for (let i = 1; i <= minLength; i++) {
        const topA = aRootList[aRootList.length - i]
        const topB = bRootList[bRootList.length - i]
        if (topA !== topB) {
          const comparison = topA.compareDocumentPosition(topB)
          // top node no longer exist
          if (comparison & Node.DOCUMENT_POSITION_DISCONNECTED) return 0
          return comparison & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
        }
      }
      // must have same root, should never happen
      return 0
    }

    const rootPositionCache = new Map()
    return (a, b) => {
      const aId = getNodeId(a)
      const bId = getNodeId(b)
      if (aId === bId) return 0
      // always use smaller key
      if (aId > bId) {
        const key = (bId << 16) + aId
        const cache = rootPositionCache.get(key)
        if (cache !== undefined) return cache * -1
        const result = compareRootPosition(b, a)
        rootPositionCache.set(key, result)
        return result * -1
      }
      const key = (aId << 16) + bId
      const cache = rootPositionCache.get(key)
      if (cache !== undefined) return cache
      const result = compareRootPosition(a, b)
      rootPositionCache.set(key, result)
      return result
    }
  })()
  const cachedCompareNodePosition = (function () {
    function compareNodePosition(a, b) {
      // iframe image
      if (a === b) return 0
      // normal node
      const comparison = a.compareDocumentPosition(b)
      if (!(comparison & Node.DOCUMENT_POSITION_DISCONNECTED)) {
        return comparison & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      }
      // node in shadow dom
      if (cachedGetRootNode(a, true) === document && cachedGetRootNode(b, true) === document) {
        return cachedCompareRootPosition(a, b)
      }
      // node not attached to document
      return 0
    }

    const nodePositionCache = new Map()
    return (a, b) => {
      const aId = getNodeId(a)
      const bId = getNodeId(b)
      if (aId === bId) return 0
      // always use smaller key
      if (aId > bId) {
        const key = (bId << 16) + aId
        const cache = nodePositionCache.get(key)
        if (cache !== undefined) return cache * -1
        const result = compareNodePosition(b, a)
        nodePositionCache.set(key, result)
        return result * -1
      }
      const key = (aId << 16) + bId
      const cache = nodePositionCache.get(key)
      if (cache !== undefined) return cache
      const result = compareNodePosition(a, b)
      nodePositionCache.set(key, result)
      return result
    }
  })()

  // wrapper size
  function calculateRefSize(widthList, heightList, domWidth, domHeight) {
    const refSizeList = []
    for (let i = 0; i < widthList.length; i++) {
      const width = widthList[i]
      const height = heightList[i]
      refSizeList.push(width > height ? [width, height] : [height, width])
    }
    // sort by area
    refSizeList.sort((a, b) => b[0] * b[1] - a[0] * a[1])

    // init min size
    const [maxLong, maxShort] = domWidth > domHeight ? [domWidth, domHeight] : [domHeight, domWidth]
    const refIndex = refSizeList.findIndex(size => size[0] === maxLong && size[1] === maxShort)
    let minLong = maxLong
    let minShort = maxShort
    for (let i = 0; i < refIndex; i++) {
      const [long, short] = refSizeList[i]
      minLong = Math.min(long, minLong)
      minShort = Math.min(short, minShort)
    }
    // iterate min size
    const factor = 1.2
    minLong = maxLong / factor
    minShort = maxShort / factor
    for (let i = refIndex + 1; i < refSizeList.length; i++) {
      const [long, short] = refSizeList[i]
      if (short >= minShort && long >= minLong) {
        minLong = Math.min(long / factor, minLong)
        minShort = Math.min(short / factor, minShort)
      }
    }

    const finalSize = Math.min(minLong, minShort) * factor - 3
    return finalSize
  }

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
      if (wrapper.offsetParent === null) {
        const style = getComputedStyle(wrapper)
        if (style.display !== 'contents' && style.position !== 'fixed') continue
      }

      const imgList = wrapper.querySelectorAll('img')
      const imageSet = new Set([...imgList].map(img => getFilename(img.src)))
      imageCountList.push(imageSet.size)
      if (imgList.length === 0) continue

      const widthList = []
      const heightList = []
      for (const img of imgList) {
        const rect = img.getBoundingClientRect()
        const width = img.naturalWidth > 15 ? Math.min(rect.width, img.naturalWidth) : rect.width
        const height = img.naturalHeight > 15 ? Math.min(rect.height, img.naturalHeight) : rect.height
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
    const useMinSize = isCustomElement || isLargeContainer(wrapperList, imageCountList) || isOneToOne(wrapperList, imageCountList, rawWidth, rawHeight, wrapperWidth, wrapperHeight)

    // use min size
    if (useMinSize) {
      const minWidth = Math.min(...rawWidth.filter(Boolean)) - 3
      const minHeight = Math.min(...rawHeight.filter(Boolean)) - 3
      options.minWidth = Math.min(minWidth, options.minWidth)
      options.minHeight = Math.min(minHeight, options.minHeight)
      return
    }

    // use ref size
    const finalSize = calculateRefSize(rawWidth, rawHeight, domWidth, domHeight)
    options.minWidth = Math.min(finalSize, options.minWidth)
    options.minHeight = Math.min(finalSize, options.minHeight)
  }

  function getElementDepth(el) {
    let depth = 0
    while (el.parentElement) {
      el = el.parentElement
      depth++
    }
    return depth
  }
  function getWrapperList(wrapper) {
    if (!wrapper) return []
    const rootNode = cachedGetRootNode(wrapper)
    if (rootNode !== document) return deepQuerySelectorAll(document.body, rootNode.host.tagName)
    const path = '*>'.repeat(getElementDepth(wrapper))
    const classList = '.' + [...wrapper.classList].map(CSS.escape).join(', .')
    const candidateList = document.querySelectorAll(`${path}div:is(${classList}):has(img)`)
    const wrapperList = [...candidateList].filter(node => node.querySelector(`:scope div:is(${classList}) img`) === null)
    return wrapperList
  }
  function getDomRawSelector(dom, wrapper) {
    let selector = dom.tagName.toLowerCase()
    // before wrapper
    let curr = dom.parentElement
    while (curr !== wrapper) {
      selector = curr.tagName.toLowerCase() + ' > ' + selector
      curr = curr.parentElement
    }
    // add wrapper class name
    if (curr.classList.length > 1) {
      selector = curr.tagName.toLowerCase() + ':is(.' + [...curr.classList].map(CSS.escape).join(', .') + ') > ' + selector
    } else if (curr.classList.length === 1) {
      selector = curr.tagName.toLowerCase() + '.' + CSS.escape(curr.classList[0]) + ' > ' + selector
    } else {
      selector = curr.tagName.toLowerCase() + ' > ' + selector
    }
    curr = curr.parentElement
    // after wrapper
    while (curr.parentElement) {
      selector = curr.tagName.toLowerCase() + ' > ' + selector
      curr = curr.parentElement
    }
    return selector
  }
  function getDomSelector(dom) {
    let curr = dom.parentElement
    let selector = dom.tagName.toLowerCase()
    // in custom element
    if (curr === null) return selector
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
    const domList = deepQuerySelectorAll(container, selector)
    const targetDom = tagName === 'IMG' ? domList.filter(img => !img.src.startsWith('data')) : domList.filter(dom => window.getComputedStyle(dom).backgroundImage !== 'none')

    const widthList = []
    const heightList = []
    for (const dom of targetDom) {
      const {width, height} = dom.getBoundingClientRect()
      if (width === 0 || height === 0) continue
      widthList.push(width)
      heightList.push(height)
    }

    // use rect size
    const maxWidth = Math.max(...widthList) - 3
    const maxHeight = Math.max(...heightList) - 3
    let useRectSize = true
    for (let i = 0; i < widthList.length; i++) {
      useRectSize &&= widthList[i] >= maxWidth || heightList[i] >= maxHeight
    }
    if (useRectSize) {
      const minWidth = Math.min(...widthList) - 3
      const minHeight = Math.min(...heightList) - 3
      options.minWidth = Math.min(minWidth, options.minWidth)
      options.minHeight = Math.min(minHeight, options.minHeight)
      return
    }

    // use ref size
    const finalSize = calculateRefSize(widthList, heightList, domWidth, domHeight)
    options.minWidth = Math.min(finalSize, options.minWidth)
    options.minHeight = Math.min(finalSize, options.minHeight)
  }

  // scroll unlazy
  async function slowScrollThoughDocument(currentX, currentY) {
    if (!isImageViewerExist()) return

    let fresh = true
    const imageCount = ImageViewer('get_image_list').length
    const haveNewImage = () => fresh || (fresh = imageCount !== ImageViewer('get_image_list').length)
    setTimeout(() => (fresh = false), 5000)

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
    if (!viewerMoveToFlag) container.scrollTo(currentX, currentY)
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
    if (!viewerMoveToFlag) container.scrollTo(currentX, currentY)
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
      while (isImageViewerExist() && lastY < container.scrollHeight && count < 5) {
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
        let loadingImageCount = deepQuerySelectorAll(document.body, 'img[iv-checking]').length
        while (loadingImageCount > 0) {
          await new Promise(resolve => setTimeout(resolve, 100))
          loadingImageCount = deepQuerySelectorAll(document.body, 'img[iv-checking]').length
        }

        if (!enableAutoScroll) break
        if (isImageViewerExist()) action()

        // check scroll complete
        await new Promise(resolve => setTimeout(resolve, 500))
        if (lastY === container.scrollTop) {
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
    const imageViewerObserver = new MutationObserver(() => {
      if (isImageViewerExist()) return
      autoScrollFlag = false
      imageViewerObserver.disconnect()
      newNodeObserver.disconnect()
      setTimeout(() => {
        const container = getMainContainer()
        if (!viewerMoveToFlag) container.scrollTo(startX, startY)
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

    const {isStopped, timer} = startAutoScroll()

    let existNewDom = false
    const newNodeObserver = new MutationObserver(() => {
      existNewDom = true
      if (isStopped()) timer()
    })
    newNodeObserver.observe(document.body, {childList: true, subtree: true})

    // help auto scroll scroll to bottom
    setTimeout(() => {
      if (isImageViewerExist() && (!existNewDom || imageListLength === ImageViewer('get_image_list').length)) {
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
    const srcUrl = cachedGetUrl(img.src)
    while (srcUrl.href !== img.currentSrc) {
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  async function preloadImage(img, src, release) {
    const deadline = Date.now() + 500
    const referrerPolicy = img.getAttribute('referrerpolicy')
    const action = resolve => {
      const temp = new Image()
      temp.onload = () => resolve(true)
      temp.onerror = () => resolve(false)
      temp.loading = 'eager'
      temp.referrerPolicy = referrerPolicy
      temp.src = src
    }

    // try default setting
    const success = await new Promise(action)
    if (success || Date.now() > deadline) {
      release()
      return success
    }
    await new Promise(resolve => setTimeout(resolve, 50))

    // try fallback
    const fallbackSuccess = await new Promise(resolve => {
      const temp = new Image()
      temp.onload = () => resolve(true)
      temp.onerror = () => resolve(false)
      temp.loading = 'eager'
      if (!referrerPolicy) temp.referrerPolicy = 'no-referrer'
      temp.src = src
    })
    if (fallbackSuccess || Date.now() > deadline) {
      release()
      img.referrerPolicy = referrerPolicy ? '' : 'no-referrer'
      return fallbackSuccess
    }
    await new Promise(resolve => setTimeout(resolve, 50))

    // normal retry
    let retrySuccess = false
    while (!retrySuccess) {
      retrySuccess = await new Promise(action)
      if (Date.now() > deadline) break
      if (!retrySuccess) await new Promise(resolve => setTimeout(resolve, 50))
    }
    release()
    return retrySuccess
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

      const length = res.headers.get('Content-Length')
      // may be transfer-encoding: chunked
      if (length === null) {
        const res = await fetch(url.href, {signal: AbortSignal.timeout(5000)})
        if (!res.ok) return 0
        let totalSize = 0
        const reader = res.body.getReader()
        while (true) {
          const {done, value} = await reader.read()
          if (done) break
          totalSize += value.length
        }
        return totalSize
      }

      const type = res.headers.get('Content-Type')
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
    if (src.startsWith('data')) return 0

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
      const url = cachedGetUrl(src)
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
  async function getImageRealSize(src, highPriority = false) {
    const cache = srcRealSizeMap.get(src)
    if (cache !== undefined) return cache

    const release = await semaphore.acquire(highPriority)
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
  async function isNewSrcBetter(currentSrc, bitSize, naturalSize, newSrc) {
    // current is placeholder
    if (badImageSet.has(currentSrc)) return true
    if (badImageSet.has(newSrc)) return false

    const baseSize = bitSize || naturalSize
    if (baseSize === 0) {
      const lazySize = (await getImageBitSize(newSrc)) || (await getImageRealSize(newSrc))
      return lazySize > 0
    }
    const getSizeFunction = bitSize ? getImageBitSize : getImageRealSize
    const lazySize = await getSizeFunction(newSrc)
    if (lazySize === 0 || lazySize < baseSize) return false
    if (lazySize > baseSize) return true
    // when same size
    const sameImage = getRawUrl(currentSrc) === getRawUrl(newSrc) || currentSrc.split('?')[0].split('/').at(-1) === newSrc.split('?')[0].split('/').at(-1)
    return !sameImage
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
      const realSrc = currentSrc.replace(/^https?:/, protocol)
      const currentSize = Math.min(img.naturalWidth, img.naturalHeight)
      const [bitSize, naturalSize] = await Promise.all([getImageBitSize(realSrc), currentSize || getImageRealSize(realSrc)])
      const isHighPriority = badImageSet.has(currentSrc)

      // loop thought remaining attr
      while (lastIndex < attrList.length) {
        const {name, url} = attrList[lastIndex++]
        complete = lastIndex === attrList.length
        // some websites does not follow fragment identifier standard
        const newSrc = url
          .replaceAll('#', '%23')
          .replace(/^https?:/, protocol)
          .replace(/^\/(?:[^/])/, origin)
        const better = await isNewSrcBetter(currentSrc, bitSize, naturalSize, newSrc)
        if (!better) continue

        // preload image
        const release = await semaphore.acquire(isHighPriority)
        const preloading = preloadImage(img, newSrc, release)
        const done = isHighPriority || (await waitPromiseComplete(preloading, 5000))
        // count overtime as success
        const success = done ? await preloading : true
        if (!success) {
          console.log(`Failed to load ${newSrc}`)
          continue
        }

        // update attr
        successList.push(name)
        const realAttrName = name.startsWith('raw ') ? name.slice(4) : name
        if (done) {
          await updateImageSrc(img, newSrc)
          img.removeAttribute(realAttrName)
          badImageSet.add(currentSrc)
          pendingBadImageMap.get(newSrc)?.forEach(url => badImageSet.add(url))
          // reset current url and size
          break
        }

        // handle overtime img
        console.log(`Image preload overtime: ${newSrc}`)
        preloading.then(async success => {
          if (!success) return
          // wait current check complete
          while (img.hasAttribute('iv-checking')) {
            await new Promise(resolve => setTimeout(resolve, 100))
          }
          checkImageAttr(img, [{name, url}])
        })
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
  function getSrcsetUrl(value) {
    const srcsetList = value
      .split(',')
      .map(str => str.trim().split(/ +/))
      .map(([url, size]) => [url, size ? Number(size.slice(0, -1)) : 1])
      .sort((a, b) => b[1] - a[1])
      .map(([url]) => cachedGetUrl(url).href)
    pendingBadImageMap.set(
      srcsetList[0],
      srcsetList.slice(1).filter(url => url !== srcsetList[0])
    )
    return srcsetList[0]
  }
  function getAttrUrl(value) {
    const src = cachedDeepDecode(value)
    const url = cachedGetUrl(src)
    const proxy = cachedGetProxySrc(url, /https?:\/\/\S+/g)
    return proxy || url.href
  }
  function checkAttrUrlPath(url, attrList) {
    const {origin, pathname, search} = url

    // check url filename
    const nonThumbnailPath = pathname.replace(/[-_]thumb(?=nail)?\./, '.')
    if (pathname !== nonThumbnailPath) {
      attrList.push({name: 'non thumbnail path', url: origin + nonThumbnailPath + search})
    }
    const filenameIndex = pathname.lastIndexOf('/')
    const filename = pathname.slice(filenameIndex + 1)
    const lastMatch = filename.matchAll(/[-_]\d{3,4}(?:x\d{3,4})?/g).reduce((_, m) => m, null)
    if (lastMatch) {
      const rawFilename = filename.slice(0, lastMatch.index) + filename.slice(lastMatch.index + lastMatch[0].length)
      const rawSizePath = pathname.slice(0, filenameIndex + 1) + rawFilename
      attrList.push({name: 'no size path', url: origin + rawSizePath + search})
    }

    // check url parameters
    if (search === '' || search === '?') return
    if (!pathname.includes('.')) {
      const extMatch = search.match(/jpeg|jpg|png|gif|webp|bmp|tiff|avif/)
      if (extMatch) {
        attrList.push({name: 'raw extension', url: origin + pathname + '.' + extMatch[0]})
      }
    }
    if (search.includes('width=') || search.includes('height=')) {
      const noSizeQuery = search.replace(/&?width=\d+|&?height=\d+/g, '')
      attrList.push({name: 'no size query', url: origin + pathname + noSizeQuery})
    }
    attrList.push({name: 'no query', url: origin + pathname})
  }
  function getUnlazyAttrList(img) {
    const src = img.currentSrc || img.src
    const rawUrl = getRawUrl(src)
    const attrList = []

    // check attributes
    for (const {name, value} of img.attributes) {
      if (attrWhiteList.has(name) || value.startsWith('data')) continue

      const length = value.split(/\s+/).filter(str => str.includes('/') || str.includes('.')).length
      if (length === 0) continue

      // count multiple match as srcset
      const attrUrl = length > 1 ? getSrcsetUrl(value) : getAttrUrl(value)
      if (attrUrl !== src) {
        attrList.push({name: name, url: attrUrl})
      }
      const rawAttrUrl = getRawUrl(attrUrl)
      if (rawAttrUrl !== attrUrl && rawAttrUrl !== rawUrl) {
        attrList.push({name: 'raw ' + name, url: rawAttrUrl})
      }
    }

    // check srcset and src
    if (img.srcset && img.srcset !== src) {
      attrList.push({name: 'srcset', url: getSrcsetUrl(img.srcset)})
    }
    if (rawUrl !== src) {
      attrList.push({name: 'raw url', url: rawUrl})
    }

    // check url path
    const url = cachedGetUrl(src)
    if (url !== null) {
      checkAttrUrlPath(url, attrList)
    }

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

    const targetImageList = deepQuerySelectorAll(document.body, 'img:not([iv-image])')
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
      const lazy = badImageSet.has(img.currentSrc) || img.naturalWidth === 0 || img.naturalHeight === 0
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
  function clearWindowBackup(svgFilter) {
    const allImageUrlSet = new Set(getImageListWithoutFilter(svgFilter).map(data => data.src))
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
      allComplete = complete && (await waitPromiseComplete(Promise.all(asyncList), 0))
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
      clearWindowBackup(options.svgFilter)
    }
  }

  // before unlazy
  function processLazyPlaceholder() {
    if (badImageSet.has(location.href)) return
    badImageSet.add(location.href)

    // calculate lazy score
    const srcScoreMap = new Map()
    for (const img of document.querySelectorAll('img[src]')) {
      const src = img.currentSrc.replace(/^https?:/, location.protocol)

      const smallImage = img.complete && img.naturalWidth + img.naturalHeight < 16 ? 1 : 0
      const gifImage = img.src.endsWith('.gif') ? 1 : 0
      const repeated = srcScoreMap.has(src) ? 1 : 0
      const imageScore = smallImage + gifImage + repeated

      const lazyClass = isLazyClass(img.className) ? 1 : 0
      const lazyScore = lazyClass ? 1 + 2 * imageScore : imageScore
      if (lazyScore === 0) continue

      const current = srcScoreMap.get(src) || 0
      srcScoreMap.set(src, current + lazyScore)
    }

    // update bad image
    for (const [src, score] of srcScoreMap) {
      if (score >= 4) {
        console.log(`Found src with ${score} lazy score ${src}`)
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
      .replaceAll(/\/\*.*?\*\//g, '')
      .split('}')
      .map(str => (str.startsWith('@') ? str.split('{')[1] : str))
      .map(str => str.match(/:(?:before|after).+background-image:url\((.+)\)/))
      .filter(Boolean)

    for (const match of matchList) {
      const rawSelector = match.input
        .split('{')[0]
        .split(',')
        .filter(s => s.includes(':'))[0]
      const index = rawSelector.lastIndexOf(':')
      // maybe single-colon in css2
      const offset = rawSelector[index - 1] === ':' ? 1 : 0
      const selector = rawSelector.substring(0, index - offset)
      const position = rawSelector.substring(index + 1)
      const domList = selector.endsWith('>') ? document.querySelectorAll(selector + '*') : document.querySelectorAll(selector)
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
    // set timeout for unlazy
    const unlazyCompleted = await isPromiseComplete(lastUnlazyTask)
    if (unlazyCompleted) {
      const clone = structuredClone(options)
      lastUnlazyTask = simpleUnlazyImage(clone)
      enableAutoScroll ? autoScroll() : scrollUnlazy()
    }
    const timeout = new Promise(resolve => setTimeout(resolve, 500))
    const race = Promise.race([lastUnlazyTask, timeout])
    return race
  }
  function startUnlazy(options) {
    // check still on same page
    if (ImageViewer('get_href') !== location.href) {
      const backupImageSrc = new Set(window.backupImageList.map(data => data.src))
      const allImageSrc = new Set(getImageListWithoutFilter().map(data => data.src))
      if (allImageSrc.intersection(backupImageSrc).size < 5) {
        unlazyFlag = false
        scrollUnlazyFlag = false
        lastUnlazyTask = null
        window.backupImageList = []
        ImageViewer('reset_image_list')
      }
    }
    // run init task
    if (lastUnlazyTask === null) {
      processLazyPlaceholder()
      fakeUserHover()
      checkPseudoCss()
      enableAutoScroll = getDomainSetting(options.autoScrollEnableList)
      disableImageUnlazy = getDomainSetting(options.imageUnlazyDisableList)
    }
    // skip unlazy
    if (disableImageUnlazy) {
      if (enableAutoScroll) autoScroll()
      lastUnlazyTask = Promise.resolve()
      return lastUnlazyTask
    }
    const race = createUnlazyRace(options)
    return race
  }

  // get iframe images
  async function getIframeImageList(options) {
    const iframeList = deepQuerySelectorAll(document.body, 'iframe')
    const iframeSrcList = []
    for (const iframe of iframeList) {
      // may throw security error
      try {
        const src = iframe.src || iframe.contentWindow.location.href
        iframeSrcList.push(src)
      } catch (e) {}
    }
    const filteredList = iframeSrcList.filter(src => src !== '' && src !== 'about:blank')
    if (filteredList.length === 0) return []

    const minSize = Math.min(options.minWidth, options.minHeight)
    const message = {msg: 'extract_frames', minSize: minSize}
    if (options.canvasMode) message.canvasMode = true

    // overtime and resume
    const lastTask = options.canvasMode ? lastIframeCanvasTask : lastIframeImageTask
    const currTask = lastTask || safeSendMessage(message)
    const ready = await waitPromiseComplete(currTask, 500)
    if (!ready) {
      if (!lastTask) {
        options.canvasMode ? (lastIframeCanvasTask = currTask) : (lastIframeImageTask = currTask)
      }
      return []
    }
    if (lastTask) {
      const task = safeSendMessage(message)
      options.canvasMode ? (lastIframeCanvasTask = task) : (lastIframeImageTask = task)
    }
    const iframeImage = (await currTask) || []
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
      imageDataList.push({src: imageSrc, dom: iframeList[rawIndex !== -1 ? rawIndex : 0]})
    }

    const imageFailureCountMap = ImageViewer('get_image_failure_count')
    const filteredDataList = imageDataList.filter(data => imageFailureCountMap.get(data.src) === undefined || imageFailureCountMap.get(data.src) < 3)
    return filteredDataList
  }

  // get page images
  async function getCanvasList(options) {
    const minWidth = options.minWidth || 0
    const minHeight = options.minHeight || 0
    const asyncList = []

    const canvasList = deepQuerySelectorAll(document.body, 'canvas')
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
  function processImageDataList(svgFilter, imageDataList) {
    const imageFailureCountMap = ImageViewer('get_image_failure_count')
    const isBadImage = svgFilter
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
    const realSize = await getImageRealSize(url, true) // high priority
    const {width, height} = node.getBoundingClientRect()
    node.removeAttribute('no-bg')
    node.setAttribute('iv-bg', url)
    node.setAttribute('iv-width', Math.min(realSize, width))
    node.setAttribute('iv-height', Math.min(realSize, height))
  }
  function getImageListWithoutFilter(svgFilter = true) {
    const imageDataList = []

    const rawImageList = deepQuerySelectorAll(document.body, `img${disableImageUnlazy ? '' : '[iv-image]'}`)
    for (const img of rawImageList) {
      imageDataList.push({src: img.currentSrc || img.src, dom: img})
    }

    const videoList = deepQuerySelectorAll(document.body, 'video[poster]')
    for (const video of videoList) {
      imageDataList.push({src: video.poster, dom: video})
    }

    const uncheckedNodeList = deepQuerySelectorAll(document.body, '*:not([no-bg])')
    if (!document.body.hasAttribute('no-bg')) uncheckedNodeList.unshift(document.body)
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

    const uniqueDataList = processImageDataList(svgFilter, imageDataList)
    return uniqueDataList
  }
  function getImageList(options) {
    const minWidth = options.minWidth
    const minHeight = options.minHeight
    if (minWidth === 0 && minHeight === 0) {
      return getImageListWithoutFilter(options.svgFilter)
    }

    const imageDataList = []

    const rawImageList = deepQuerySelectorAll(document.body, `img${disableImageUnlazy ? '' : '[iv-image]'}`)
    for (const img of rawImageList) {
      // only client size should be checked in order to bypass large icon or hidden image
      const {width, height} = img.getBoundingClientRect()
      if ((width >= minWidth && height >= minHeight) || img === window.ImageViewerLastDom) {
        // currentSrc might be empty during unlazy or update
        imageDataList.push({src: img.currentSrc || img.src, dom: img})
      }
    }

    const videoList = deepQuerySelectorAll(document.body, 'video[poster]')
    for (const video of videoList) {
      const {width, height} = video.getBoundingClientRect()
      if (width >= minWidth && height >= minHeight) {
        imageDataList.push({src: video.poster, dom: video})
      }
    }

    const uncheckedNodeList = deepQuerySelectorAll(document.body, '*:not([no-bg])')
    if (!document.body.hasAttribute('no-bg')) uncheckedNodeList.unshift(document.body)
    for (const node of uncheckedNodeList) {
      const [width, height] = getNodeSize(node)
      if (width < minWidth || height < minHeight) continue
      const attrUrl = node.getAttribute('iv-bg')
      if (attrUrl !== null) {
        imageDataList.push({src: attrUrl, dom: node})
        continue
      }
      const backgroundImage = window.getComputedStyle(node).backgroundImage
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

    const uniqueDataList = processImageDataList(options.svgFilter, imageDataList)
    return uniqueDataList
  }

  // sort image list
  function sortImageDataList(dataList) {
    if (dataList.length < 2) return dataList

    const length = dataList.length
    let subArraySize = 1
    while (subArraySize < length) {
      let startIndex = 0
      // merge sub array
      while (startIndex < length) {
        const leftStart = startIndex
        const rightStart = Math.min(startIndex + subArraySize, length)
        const rightEnd = Math.min(startIndex + 2 * subArraySize, length)
        startIndex += 2 * subArraySize
        if (rightStart === length) continue

        // already sorted
        if (cachedCompareNodePosition(dataList[rightStart - 1].dom, dataList[rightStart].dom) <= 0) continue

        // insertion sort
        let leftIndex = leftStart
        let rightIndex = rightStart
        while (leftIndex < rightIndex && rightIndex < rightEnd) {
          if (cachedCompareNodePosition(dataList[leftIndex].dom, dataList[rightIndex].dom) <= 0) {
            leftIndex++
          } else {
            // shift element
            const temp = dataList[rightIndex]
            for (let i = rightIndex; i > leftIndex; i--) {
              dataList[i] = dataList[i - 1]
            }
            dataList[leftIndex++] = temp
            rightIndex++
          }
        }
      }
      subArraySize *= 2
    }
    return dataList
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
  function createImageIndexSearcher(dataList) {
    function searchIndex(data) {
      const {src, dom} = data
      const domIndex = domIndexMap.get(dom)
      if (domIndex !== undefined) return domIndex
      const srcIndex = srcIndexMap.get(src)
      if (srcIndex !== undefined) return srcIndex
      const rawIndex = srcIndexMap.get(getRawUrl(src))
      return rawIndex !== undefined ? rawIndex : -1
    }
    function updateCache(dataList, currLength) {
      for (let i = lastLength; i < currLength; i++) {
        const {src, dom} = dataList[i]
        srcIndexMap.set(src, i)
        if (dom.tagName !== 'IFRAME') domIndexMap.set(dom, i)
      }
      lastLength = currLength
    }

    // assumes previous src unchange
    let lastLength = 0
    const srcIndexMap = new Map()
    const domIndexMap = new Map()
    updateCache(dataList)

    return {
      searchIndex: searchIndex,
      updateCache: updateCache
    }
  }

  // combine image list
  function handleShuffledList(newList, oldList, oldSearcher) {
    let shuffled = false
    let lastCheckIndex = -1
    for (const data of newList) {
      const index = oldSearcher.searchIndex(data)
      if (index === -1 || oldList[index].dom.tagName !== data.dom.tagName) continue
      if (index > lastCheckIndex) {
        lastCheckIndex = index
      } else {
        shuffled = true
        break
      }
    }
    if (!shuffled) return

    for (let i = newList.length - 1; i >= 0; i--) {
      const data = newList[i]
      const index = oldSearcher.searchIndex(data)
      if (index !== -1) newList.splice(i, 1)
    }
  }
  function insertionJoinImageList(newList, oldList, oldSearcher) {
    const combinedDataList = new Array(newList.length + oldList.length)
    const combinedSearcher = createImageIndexSearcher([])

    let leftIndex = 0
    let rightIndex = 0
    let indexAtOldArray = -1
    let indexAtCombinedArray = -1
    let vacancyIndex = 0
    let oldArrayLastIndex = 0
    let distance = 0
    while (rightIndex < newList.length) {
      // get right index
      const right = newList[rightIndex]
      indexAtOldArray = oldSearcher.searchIndex(right)
      indexAtCombinedArray = combinedSearcher.searchIndex(right)
      // right is not a anchor
      if (indexAtOldArray === -1 || (indexAtOldArray !== -1 && indexAtCombinedArray !== -1)) {
        rightIndex++
        continue
      }
      // fill list with oldList (exclude right)
      distance = indexAtOldArray - oldArrayLastIndex
      for (let i = 0; i < distance; i++) {
        combinedDataList[vacancyIndex++] = oldList[oldArrayLastIndex++]
      }
      // fill list with newList from left index to right index
      distance = rightIndex - leftIndex + 1
      for (let i = 0; i < distance; i++) {
        combinedDataList[vacancyIndex++] = newList[leftIndex++]
      }
      rightIndex = leftIndex
      oldArrayLastIndex++
      combinedSearcher.updateCache(combinedDataList, vacancyIndex)
    }

    // fill list with remained oldList
    distance = oldList.length - oldArrayLastIndex
    for (let i = 0; i < distance; i++) {
      combinedDataList[vacancyIndex++] = oldList[oldArrayLastIndex++]
    }
    // last element of newList is not a anchor
    if (indexAtOldArray === -1 || (indexAtOldArray !== -1 && indexAtCombinedArray !== -1)) {
      // fill list with remained newList
      distance = newList.length - leftIndex
      for (let i = 0; i < distance; i++) {
        combinedDataList[vacancyIndex++] = newList[leftIndex++]
      }
    }
    return combinedDataList
  }
  function clearCombinedDataList(combinedDataList, newList) {
    const finalList = combinedDataList.filter(Boolean)

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
      const newDom = newSrcDomMap.get(data.src)
      if (newDom && (newDom.tagName === 'IMG' || data.dom.tagName !== 'IMG')) {
        data.dom = newDom
      }
    }

    return uniqueFinalList
  }

  return {
    updateWrapperSize: function (dom, domSize, options) {
      if (!dom || cachedGetRootNode(dom, true) !== document) return

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
      // wrapper is custom element, check all images in wrapper list
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
      // not all images in wrapper match selector
      const selector = getDomRawSelector(dom, wrapper)
      const domList = deepQuerySelectorAll(document.body, selector)
      const wrapperImageList = wrapperList.flatMap(wrapper => [...wrapper.querySelectorAll('img')])
      if (domList.length < wrapperImageList.length) {
        updateSizeBySelector(domWidth, domHeight, document.body, 'IMG', selector, options)
        return
      }
      // check all images in wrapper list
      updateSizeByWrapper(wrapperList, domWidth, domHeight, options)
    },

    getOrderedImageList: async function (options, retryCount = 3) {
      if (retryCount === 0) return []

      const unlazyPromise = startUnlazy(options)
      const iframePromise = getIframeImageList(options)
      await Promise.all([unlazyPromise, iframePromise])

      const iframeImageList = await iframePromise
      const imageList = getImageList(options)

      const uniqueImageList = iframeImageList.concat(imageList)
      if (uniqueImageList.length === 0) {
        console.log('Found no image')
        return this.getOrderedImageList(options, retryCount - 1)
      }

      setTimeout(scrollRelease, 0)
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

    searchImageInfoIndex: function (data, imageList) {
      if (data.dom) data.src = getDomUrl(data.dom)
      const searcher = createImageIndexSearcher(imageList)
      const index = searcher.searchIndex(data)
      return index
    },

    combineImageList: function (newList, oldList) {
      const imageFailureCountMap = ImageViewer('get_image_failure_count')
      oldList = oldList.filter(data => !badImageSet.has(data.src) && (imageFailureCountMap.get(data.src) ?? 0) < 3)
      if (newList.length === 0 || oldList.length === 0) return newList.concat(oldList)

      removeRepeatNonRaw(newList, oldList)

      // relative order may not be preserved
      const oldSearcher = createImageIndexSearcher(oldList)
      handleShuffledList(newList, oldList, oldSearcher)

      const combinedDataList = insertionJoinImageList(newList, oldList, oldSearcher)
      const uniqueFinalList = clearCombinedDataList(combinedDataList, newList)
      return sortImageDataList(uniqueFinalList)
    },

    isStrLengthEqual: function (newList, oldList) {
      const newListStringLength = newList.map(data => data.src.length).reduce((a, b) => a + b, 0)
      const oldListStringLength = oldList.map(data => data.src.length).reduce((a, b) => a + b, 0)
      return newListStringLength === oldListStringLength
    },

    getMainContainer: getMainContainer,

    getRawUrl: getRawUrl,

    getFilename: getFilename,

    getImageRealSize: getImageRealSize
  }
})()
