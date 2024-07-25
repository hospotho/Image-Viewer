window.ImageViewerUtils = (function () {
  'use strict'

  const safeSendMessage = function (...args) {
    if (chrome.runtime?.id) {
      return chrome.runtime.sendMessage(...args)
    }
  }

  const passList = new Set(['class', 'style', 'src', 'srcset', 'alt', 'title', 'loading', 'crossorigin', 'width', 'height', 'max-width', 'max-height', 'sizes', 'onerror', 'data-error'])
  const urlRegex = /(?:https?:\/)?\/\S+/g
  const protocol = location.protocol
  const origin = location.origin + '/'
  const srcBitSizeMap = new Map()
  const srcRealSizeMap = new Map()
  const badImageList = new Set(['', 'about:blank'])
  const corsHostList = new Set()
  const mutex = (() => {
    // update image
    let promise = Promise.resolve()
    let busy = false
    // parallel fetch
    const maxParallel = 8
    let fetchCount = 0
    const isAvailable = () => fetchCount < maxParallel
    return {
      acquire: async function () {
        await promise
        let lockRelease = () => {}
        promise = new Promise(resolve => {
          lockRelease = () => {
            busy = false
            resolve()
          }
        })
        busy = true
        return lockRelease
      },
      waitUnlock: async function () {
        if (busy) return promise

        let waitRelease = () => {}
        const wait = new Promise(resolve => (waitRelease = resolve))
        const originalAcquire = mutex.acquire
        mutex.acquire = async () => {
          const lockRelease = await originalAcquire()
          waitRelease()
          mutex.acquire = originalAcquire
          return lockRelease
        }

        await wait
        await promise
      },
      waitSlot: async function () {
        let executed = false
        while (!isAvailable()) {
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        fetchCount++
        return () => {
          if (!executed) fetchCount--
          executed = true
        }
      }
    }
  })()

  let unlazyCount = 0
  let raceCount = 0
  let lastHref = ''
  let scrollUnlazyFlag = false
  let autoScrollFlag = false

  // init function hotkey
  window.addEventListener(
    'keydown',
    e => {
      if (!isImageViewerExist()) return
      // enable auto scroll
      if (checkKey(e, window.ImageViewerOption.functionHotkey[0])) {
        e.preventDefault()
        if (!document.documentElement.classList.contains('enableAutoScroll')) {
          console.log('Enable auto scroll')
          document.documentElement.classList.add('enableAutoScroll')
          document.documentElement.classList.remove('disableAutoScroll')
        } else {
          console.log('Disable auto scroll')
          document.documentElement.classList.add('disableAutoScroll')
          document.documentElement.classList.remove('enableAutoScroll')
        }
        if (unlazyCount > 0) autoScroll()
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
      if (element.classList.contains('updateByObserver')) {
        updatedSet.add(element)
        continue
      }
      if (element.classList.contains('simpleUnlazy') && !element.classList.contains('unlazyNotComplete')) {
        modifiedSet.add(element)
      }
    }
    for (const img of updatedSet) {
      img.classList.remove('updateByObserver')
    }
    for (const img of modifiedSet) {
      img.classList.add('updateByObserver')
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

  function isEnabledAutoScroll(options) {
    if (document.documentElement.classList.contains('enableAutoScroll')) {
      return true
    }
    if (document.documentElement.classList.contains('disableAutoScroll')) {
      return false
    }
    const domainList = []
    const regexList = []
    for (const str of options.autoScrollEnableList) {
      if (str[0] === '/' && str[str.length - 1] === '/') {
        regexList.push(new RegExp(str.slice(1, -1)))
      } else {
        domainList.push(str)
      }
    }
    const enableAutoScroll = domainList.includes(location.hostname.replace('www.', '')) || regexList.map(regex => regex.test(location.href)).filter(Boolean).length > 0
    if (enableAutoScroll) document.documentElement.classList.add('enableAutoScroll')
    return enableAutoScroll
  }
  function isLazyClass(className) {
    if (className === '') return false
    const lower = className.toLowerCase()
    return lower.includes('lazy') || lower.includes('loading')
  }
  function isImageViewerExist() {
    return document.documentElement.classList.contains('has-image-viewer')
  }

  function deepQuerySelectorAll(target, tagName, selector) {
    const result = []
    for (const node of target.querySelectorAll(`${selector}, *:not([no-shadow])`)) {
      if (node.tagName.toUpperCase() === tagName) {
        result.push(node)
      }
      if (node.shadowRoot) {
        result.push(...deepQuerySelectorAll(node.shadowRoot, tagName, selector))
        continue
      }
      node.setAttribute('no-shadow', '')
    }
    return result
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

  function getDomUrl(dom) {
    const tag = dom.tagName
    if (tag === 'IMG') return dom.currentSrc || dom.src
    if (tag === 'VIDEO') return dom.poster
    const backgroundImage = window.getComputedStyle(dom).backgroundImage
    const bg = backgroundImage.split(', ')[0]
    return bg.substring(5, bg.length - 2)
  }
  function getImageInfoIndex(srcList, src) {
    const index = srcList.indexOf(src)
    if (index !== -1) return index
    const rawIndex = srcList.indexOf(getRawUrl(src))
    if (rawIndex !== -1) return rawIndex
    const filename = getFilename(src)
    const filenameIndexList = srcList.map((src, i) => [getFilename(src), i]).filter(item => item[0] === filename)
    if (filenameIndexList.length === 1) return filenameIndexList[0][1]
    return -1
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

    let minWidth = domWidth
    let minHeight = domHeight
    for (const dom of targetDom) {
      const {width, height} = dom.getBoundingClientRect()
      if (width !== 0 && height !== 0) {
        minWidth = Math.min(minWidth, width)
        minHeight = Math.min(minHeight, height)
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

    const release = await mutex.acquire()
    release()

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
          found = !element.classList.contains('updateByObserver') && !element.classList.contains('simpleUnlazy')
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
      let lastUnlazyCount = unlazyCount
      let count = 0
      while (lastY < container.scrollHeight) {
        if (count > 5 || !isImageViewerExist()) break

        while (document.visibilityState !== 'visible' || !document.documentElement.classList.contains('enableAutoScroll')) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }

        // wait unlazyCount update and current task complete
        while (raceCount >= unlazyCount || lastUnlazyCount === unlazyCount) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        await mutex.waitUnlock()

        // wait for image collection
        await mutex.waitUnlock()

        action()
        lastUnlazyCount = unlazyCount

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
  async function waitSrcUpdate(img, _resolve) {
    const srcUrl = new URL(img.src, document.baseURI)
    while (srcUrl.href !== img.currentSrc) {
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    _resolve()
  }
  function updateImageSource(img, src) {
    return new Promise(resolve => {
      const temp = new Image()
      temp.onload = () => {
        img.src = src
        img.srcset = src
        const picture = img.parentNode
        if (picture?.tagName === 'PICTURE') {
          for (const source of picture.querySelectorAll('source')) {
            source.srcset = src
          }
        }
        waitSrcUpdate(img, resolve)
      }
      temp.onerror = resolve
      temp.loading = 'eager'
      temp.referrerPolicy = img.referrerPolicy
      temp.src = src
    })
  }
  async function localFetchBitSize(url) {
    const release = await mutex.waitSlot()
    if (corsHostList.has(url.hostname)) {
      release()
      return 0
    }

    const controller = new AbortController()
    setTimeout(() => controller.abort(), 5000)
    try {
      const res = await fetch(url.href, {method: 'HEAD', signal: controller.signal})
      release()
      if (res.ok) {
        if (res.redirected) return -1
        const type = res.headers.get('Content-Type')
        const length = res.headers.get('Content-Length')
        if (type?.startsWith('image') || (type === 'application/octet-stream' && cachedExtensionMatch(href))) {
          const size = Number(length)
          return size
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) corsHostList.add(url.hostname)
    }
    release()
    return 0
  }
  function getImageBitSize(src) {
    if (!src || src === 'about:blank' || src.startsWith('data')) return 0

    const cache = srcBitSizeMap.get(src)
    if (cache !== undefined) return cache

    return new Promise(_resolve => {
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
      localFetchBitSize(url).then(updateSize)
    })
  }
  async function getImageRealSize(src) {
    const cache = srcRealSizeMap.get(src)
    if (cache !== undefined) return cache

    const release = await mutex.waitSlot()
    return new Promise(_resolve => {
      const resolve = size => {
        srcRealSizeMap.set(src, size)
        release()
        _resolve(size)
      }

      const img = new Image()
      img.onload = () => resolve(Math.min(img.naturalWidth, img.naturalHeight))
      img.onerror = () => resolve(0)
      setTimeout(() => resolve(0), 10000)
      img.src = src
    })
  }
  async function getBetterUrl(currentSrc, bitSize, naturalSize, newURL) {
    const baseSize = bitSize > 0 ? bitSize : naturalSize
    const getSizeFunction = bitSize > 0 ? getImageBitSize : getImageRealSize
    const lazySize = await getSizeFunction(newURL)
    if (lazySize === 0 || lazySize < baseSize) return null
    if (lazySize > baseSize) return newURL
    // when same size
    const isSameImage = getRawUrl(currentSrc) === getRawUrl(newURL) || currentSrc.split('?')[0].split('/').at(-1) === newURL.split('?')[0].split('/').at(-1)
    if (!isSameImage) return newURL
    return null
  }
  async function checkImageAttr(img, attrList) {
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
        const newURL = attr.value.replace(/https?:/, protocol).replace(/^\/(?:[^\/])/, origin)
        const betterUrl = await getBetterUrl(currentSrc, bitSize, naturalSize, newURL)
        if (betterUrl !== null) {
          const realAttrName = attr.name.startsWith('raw ') ? attr.name.slice(4) : attr.name
          img.removeAttribute(realAttrName)
          successList.push(attr.name)
          await updateImageSource(img, betterUrl)
          badImageList.add(currentSrc)
          break
        }
      }
    }
    if (successList.length) {
      for (const className of img.classList) {
        if (isLazyClass(className)) img.classList.remove(className)
      }
    }
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

    const targetImageList = deepQuerySelectorAll(document.body, 'IMG', 'img:not(.simpleUnlazy)')
    for (const img of targetImageList) {
      img.loading = 'eager'
      if (img.getAttribute('decoding')) img.decoding = 'sync'

      const attrList = getUnlazyAttrList(img)
      if (attrList.length === 0) {
        img.classList.add('simpleUnlazy')
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
  async function unlazyImage(minWidth, minHeight) {
    const {imgWithAttrList, allComplete} = getUnlazyImageList(minWidth, minHeight)
    const listSize = imgWithAttrList.length
    if (listSize === 0) return allComplete

    console.log(`Try to unlazy ${listSize} image`)
    imgWithAttrList.forEach(item => item[0].classList.add('simpleUnlazy', 'unlazyNotComplete'))

    const asyncList = await Promise.all(imgWithAttrList.map(([img, attrList]) => checkImageAttr(img, attrList)))
    imgWithAttrList.forEach(item => item[0].classList.remove('unlazyNotComplete'))
    const lazyList = asyncList.flat()

    if (lazyList.length > listSize) console.log('Multiple unlazy attributes found')
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

    return false
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

    let allComplete = await unlazyImage(minWidth, minHeight)
    while (!allComplete) {
      await new Promise(resolve => setTimeout(resolve, 100))
      allComplete = await unlazyImage(minWidth, minHeight)
    }

    if (unlazyCount++ === 0) {
      console.log('First unlazy complete')
      clearWindowBackup(options)
    }

    isEnabledAutoScroll(options) ? autoScroll() : scrollUnlazy()
  }

  // before unlazy
  function createUnlazyRace(options) {
    // slow connection alert
    if (raceCount + unlazyCount === 0) {
      setTimeout(() => {
        if (unlazyCount !== 0) return
        const unlazyList = deepQuerySelectorAll(document.body, 'IMG', 'img:not(.simpleUnlazy)')
        const stillLoading = [...unlazyList].some(img => !img.complete && img.loading !== 'lazy')
        if (stillLoading) {
          console.log('Slow connection, images still loading')
          alert('Slow connection, images still loading')
        }
      }, 10000)
    }

    // set timeout for unlazy
    const timeout = new Promise(resolve =>
      setTimeout(() => {
        resolve()
        raceCount++
      }, 1000)
    )
    const clone = structuredClone(options)
    const race = Promise.race([simpleUnlazyImage(clone), timeout])
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
        srcBitSizeMap.set(src, 0)
        srcRealSizeMap.set(src, 0)
        badImageList.add(src)
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
  function startUnlazy(options) {
    if (unlazyCount + raceCount === 0) {
      preprocessLazyPlaceholder()
      fakeUserHover()
    }
    if (lastHref !== '' && lastHref !== location.href) {
      const allImageOnPage = new Set(getImageListWithoutFilter(options).map(data => data.src))
      const unchangedCount = new Set(window.backupImageList).intersection(allImageOnPage).size
      if (unchangedCount < 5) {
        unlazyCount = 0
        raceCount = 0
        window.backupImageList = []
        ImageViewer('reset_image_list')
      }
    }
    lastHref = location.href
    const race = createUnlazyRace(options)
    return race
  }

  // get image
  async function getIframeImage(options) {
    const iframeList = [...document.getElementsByTagName('iframe')]
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
    const isBadImage = options.svgFilter ? url => badImageList.has(url) || url.startsWith('data:image/svg') || url.includes('.svg') : url => badImageList.has(url)

    const filteredDataList = imageDataList.filter(data => !isBadImage(data.src))

    const imageUrlMap = new Map()
    for (const data of filteredDataList) {
      const url = data.src
      const rawUrl = getRawUrl(url)
      if (url !== rawUrl) {
        const cache = imageUrlMap.get(rawUrl)
        if (cache === undefined) imageUrlMap.set(rawUrl, [url])
        else if (cache instanceof Array) cache.push(url)
        else continue
      }
      const cache = imageUrlMap.get(url)
      if (cache === undefined) imageUrlMap.set(url, data)
      else if (cache instanceof Array) {
        cache.forEach(url => imageUrlMap.delete(url))
        imageUrlMap.set(url, data)
      } else if (cache.dom.tagName !== 'IMG' && data.dom.tagName === 'IMG') imageUrlMap.set(url, data)
    }

    const uniqueDataList = Array.from(imageUrlMap, ([k, v]) => v).filter(data => data.src)
    return uniqueDataList
  }
  function getImageListWithoutFilter(options) {
    const imageDataList = []

    const rawImageList = deepQuerySelectorAll(document.body, 'IMG', 'img.simpleUnlazy')
    for (const img of rawImageList) {
      const imgSrc = img.currentSrc || img.src
      imageDataList.push({src: imgSrc, dom: img})
    }

    const uncheckedNodeList = document.body.querySelectorAll('*:not([no-bg])')
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
      const bg = backgroundImage.split(', ')[0]
      if (bg.startsWith('url') && !bg.endsWith('.svg")')) {
        const url = bg.substring(5, bg.length - 2)
        node.setAttribute('data-bg', url)
        imageDataList.push({src: url, dom: node})
      }
    }

    const videoList = document.querySelectorAll('video[poster]')
    for (const video of videoList) {
      imageDataList.push({src: video.poster, dom: video})
    }

    const uniqueDataList = processImageDataList(options, imageDataList)
    return uniqueDataList
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
  async function getImageList(options) {
    const minWidth = options.minWidth
    const minHeight = options.minHeight
    if (minWidth === 0 && minHeight === 0) {
      return getImageListWithoutFilter(options)
    }

    const imageDataList = []

    const rawImageList = deepQuerySelectorAll(document.body, 'IMG', 'img.simpleUnlazy')
    for (const img of rawImageList) {
      // only client size should be checked in order to bypass large icon or hidden image
      const {width, height} = img.getBoundingClientRect()
      if ((width >= minWidth && height >= minHeight) || img === window.ImageViewerLastDom) {
        // currentSrc might be empty during unlazy or update
        const imgSrc = img.currentSrc || img.src
        imageDataList.push({src: imgSrc, dom: img})
      }
    }

    const uncheckedNodeList = document.body.querySelectorAll('*:not([no-bg])')
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
      const bg = backgroundImage.split(', ')[0]
      if (bg.startsWith('url') && !bg.endsWith('.svg")')) {
        const url = bg.substring(5, bg.length - 2)
        node.setAttribute('data-bg', url)
        if (nodeStyle.backgroundRepeat === 'repeat') {
          const realSize = await getImageRealSize(url)
          node.setAttribute('data-width', realSize)
          node.setAttribute('data-height', realSize)
          if (realSize >= minWidth && realSize >= minHeight) imageDataList.push({src: url, dom: node})
        } else {
          imageDataList.push({src: url, dom: node})
        }
      }
    }

    const videoList = document.querySelectorAll('video[poster]')
    for (const video of videoList) {
      const {width, height} = video.getBoundingClientRect()
      if (width >= minWidth && height >= minHeight) {
        imageDataList.push({src: video.poster, dom: video})
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

    getOrderedImageList: async function (options, retryCount = 0) {
      const release = await mutex.acquire()
      try {
        await startUnlazy(options)
        const uniqueImageList = (await Promise.all([getImageList(options), getIframeImage(options)])).flat()

        release()
        if (uniqueImageList.length === 0) {
          if (retryCount < 3) {
            await new Promise(resolve => setTimeout(resolve, 1000))
            const retryResult = await this.getOrderedImageList(options, retryCount + 1)
            return retryResult
          }
          console.log('Found no image')
          return []
        }

        const orderedImageList = sortImageDataList(uniqueImageList)
        return orderedImageList
      } catch (error) {
        console.log(error)
        release()
        return []
      }
    },

    searchImageInfoIndex: function (input, imageList) {
      const srcList = imageList.map(data => data.src)
      const src = typeof input === 'object' ? getDomUrl(input) : input
      return getImageInfoIndex(srcList, src)
    },

    combineImageList: function (newList, oldList) {
      oldList = oldList.filter(data => !badImageList.has(data.src))
      if (newList.length === 0 || oldList.length === 0) return newList.concat(oldList)

      removeRepeatNonRaw(newList, oldList)

      const oldSrcList = oldList.map(data => data.src)
      const combinedImageList = new Array(newList.length + oldList.length)

      let leftIndex = 0
      let rightIndex = 0
      let indexAtOldArray = -1
      let indexAtCombinedArray = -1
      let vacancyIndex = 0
      let oldArrayLastIndex = 0
      let distance = 0

      while (rightIndex < newList.length) {
        const right = newList[rightIndex]

        const combineSrcList = combinedImageList.filter(Boolean).map(data => data.src)
        indexAtOldArray = getImageInfoIndex(oldSrcList, right.src)
        indexAtCombinedArray = getImageInfoIndex(combineSrcList, right.src)

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

      const newSrcList = newList.map(data => data.src)
      for (const data of uniqueFinalList) {
        if (data.dom.getRootNode({composed: true}) !== document) {
          const index = newSrcList.indexOf(data.src)
          data.dom = index !== -1 ? newList[index].dom : data.dom
        }
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

    getRawUrl: getRawUrl
  }
})()
