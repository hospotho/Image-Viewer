window.ImageViewerUtils = (function () {
  'use strict'

  const safeSendMessage = function (...args) {
    if (chrome.runtime?.id) {
      return chrome.runtime.sendMessage(...args)
    }
  }

  const passList = new Set(['class', 'style', 'src', 'srcset', 'alt', 'title', 'loading', 'crossorigin', 'width', 'height', 'max-width', 'max-height', 'sizes', 'onerror', 'data-error'])
  const urlRegex = /(?:https?:\/)?\/\S+/g
  const extensionRegex = /(.*?[=.](?:jpeg|jpg|png|gif|webp|bmp|tiff|avif))(?!\/)/i
  const protocol = window.location.protocol
  const srcBitSizeMap = new Map()
  const srcRealSizeMap = new Map()
  const rawUrlCache = new Map()
  const matchCache = new Map()
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
        let lockRelease = null
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

        let waitRelease = null
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

  let firstUnlazyFlag = true
  let firstUnlazyCompleteFlag = false
  let firstUnlazyScrollFlag = false
  let autoScrollFlag = false
  let lastHref = ''

  // init function hotkey
  const options = window.ImageViewerOption
  window.addEventListener(
    'keydown',
    e => {
      if (!isImageViewerExist()) return
      // enable auto scroll
      if (checkKey(e, options.functionHotkey[0])) {
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
        if (firstUnlazyCompleteFlag) autoScroll()
      }
      // download images
      if (typeof ImageViewer === 'function' && checkKey(e, options.functionHotkey[1])) {
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
  function cachedExtensionMatch(str) {
    if (str.startsWith('data')) return null

    const cache = matchCache.get(str)
    if (cache !== undefined) return cache

    const extensionMatch = str.match(extensionRegex)
    matchCache.set(str, extensionMatch)
    return extensionMatch
  }
  function matchUrlSearch(src) {
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
      const noSearch = baseURI + imgSearch

      const extensionMatch = cachedExtensionMatch(noSearch)
      return extensionMatch
    } catch (error) {
      return null
    }
  }
  function getRawUrl(src) {
    if (src.startsWith('data')) return src

    const cache = rawUrlCache.get(src)
    if (cache !== undefined) return cache

    const searchMatch = matchUrlSearch(src)
    if (searchMatch) {
      const rawUrl = searchMatch[1]
      if (rawUrl !== src) {
        rawUrlCache.set(src, rawUrl)
        return rawUrl
      }
    }

    const extensionMatch = cachedExtensionMatch(src)
    if (extensionMatch) {
      const rawUrl = extensionMatch[1]
      rawUrlCache.set(src, rawUrl)
      return rawUrl
    }
    rawUrlCache.set(src, src)
    return src
  }
  function getDomUrl(dom) {
    const tag = dom.tagName
    if (tag === 'IMG') return dom.currentSrc || dom.src
    if (tag === 'VIDEO') return dom.poster
    const backgroundImage = window.getComputedStyle(dom).backgroundImage
    const bg = backgroundImage.split(', ')[0]
    return bg.substring(5, bg.length - 2)
  }
  function getImageInfoIndex(array, data) {
    const srcArray = array.map(item => (typeof item === 'string' ? item : item[0]))
    const query = typeof data === 'string' ? data : data[0]
    const result = srcArray.indexOf(query)
    if (result !== -1) return result
    return srcArray.indexOf(getRawUrl(query))
  }
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
  function processWrapperList(wrapperDivList) {
    // treat long size as width
    const divWidth = []
    const divHeight = []
    // store raw value of each img
    const rawWidth = []
    const rawHeight = []
    const imageCountPerDiv = []
    let imageCount = 0
    let maxImageCount = 0
    for (const div of wrapperDivList) {
      // ad may use same wrapper and adblock set it to display: none
      if (div.offsetParent === null && div.style.position !== 'fixed') continue

      const imgList = div.querySelectorAll('img')
      imageCount += imgList.length
      maxImageCount = Math.max(maxImageCount, imgList.length)
      imageCountPerDiv.push(imgList.length)
      if (imgList.length === 0) continue

      const widthList = []
      const heightList = []
      for (const img of imgList) {
        const {width, height} = img.getBoundingClientRect()
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
      divWidth.push(maxWidth)
      divHeight.push(maxHeight)
    }
    return {maxImageCount, imageCount, imageCountPerDiv, rawWidth, rawHeight, divWidth, divHeight}
  }
  function updateSizeByWrapper(wrapperDivList, domWidth, domHeight, options) {
    const {maxImageCount, imageCount, imageCountPerDiv, rawWidth, rawHeight, divWidth, divHeight} = processWrapperList(wrapperDivList)

    const largeContainerCount = imageCountPerDiv.filter(num => num === maxImageCount).length
    const isLargeContainer = maxImageCount >= 5 && wrapperDivList.length - largeContainerCount < 3
    const isOneToOne = !isLargeContainer && imageCount === wrapperDivList.length
    const isMatchSize = isOneToOne && checkMatchSize(rawWidth, rawHeight)
    const useMinSize = isLargeContainer || isMatchSize

    const getMinSize = rawSizeList => Math.min(...rawSizeList.filter(Boolean))
    const getRefSize = (sizeList, domSize, optionSize) => Math.min(...sizeList.filter(s => s * 1.5 >= domSize || s * 1.2 >= optionSize))

    // treat long size as width
    const [large, small] = domWidth > domHeight ? [domWidth, domHeight] : [domHeight, domWidth]
    const [optionLarge, optionSmall] = options.minWidth > options.minHeight ? [options.minWidth, options.minHeight] : [options.minHeight, options.minWidth]
    const finalWidth = useMinSize ? getMinSize(rawWidth) : getRefSize(divWidth, large, optionLarge)
    const finalHeight = useMinSize ? getMinSize(rawHeight) : getRefSize(divHeight, small, optionSmall)

    // not allow size below 50 to prevent icon
    const finalSize = Math.max(useMinSize ? 0 : 50, Math.min(finalWidth, finalHeight)) - 3
    options.minWidth = Math.min(finalSize, options.minWidth)
    options.minHeight = Math.min(finalSize, options.minHeight)
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
  function updateSizeBySelector(domWidth, domHeight, container, selector, options) {
    const elementTag = selector.slice(-3)
    const domList = [...container.querySelectorAll(selector)]
    // skip img with data URL
    const targetDom = elementTag === 'img' ? domList.filter(img => !img.src.startsWith('data')) : domList

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
    const container = getMainContainer()
    container.scrollTo(0, 0)
    let currTop = -1
    while (currTop !== container.scrollTop) {
      currTop = container.scrollTop
      container.scrollBy({top: window.innerHeight * 2, behavior: 'smooth'})
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    container.scrollTo(currentX, currentY)
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
    if (firstUnlazyScrollFlag) return

    firstUnlazyScrollFlag = true
    while (document.readyState !== 'complete') {
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    await new Promise(resolve => setTimeout(resolve, 500))
    if (!isImageViewerExist()) {
      firstUnlazyScrollFlag = false
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
          found = !element.classList.contains('updateByObserver') || !element.classList.contains('simpleUnlazy')
          if (found) break
        }
        // new image added to the page
        if (mutation.addedNodes.length) {
          found = [...mutation.addedNodes].some(node => node.tagName === 'IMG')
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
      img.src = src
      img.srcset = src

      const picture = img.parentNode
      if (picture?.tagName === 'PICTURE') {
        for (const source of picture.querySelectorAll('source')) {
          source.srcset = src
        }
      }

      waitSrcUpdate(img, resolve)
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
  function getImageRealSize(src) {
    const cache = srcRealSizeMap.get(src)
    if (cache !== undefined) return cache

    return new Promise(_resolve => {
      const resolve = size => {
        srcRealSizeMap.set(src, size)
        _resolve(size)
      }

      const img = new Image()
      img.onload = () => resolve(Math.min(img.naturalWidth, img.naturalHeight))
      img.onerror = () => resolve(0)
      img.src = src
    })
  }
  async function getUrlSize(getSizeFunction, urlList) {
    if (urlList.length === 1) {
      const lazySize = await getSizeFunction(urlList[0])
      return [lazySize, urlList[0]]
    } else {
      const [firstSize, lastSize] = await Promise.all(urlList.map(getSizeFunction))
      return firstSize > lastSize ? [firstSize, urlList[0]] : [lastSize, urlList[1]]
    }
  }
  async function getBetterUrl(currentSrc, bitSize, naturalSize, ...urlList) {
    if (bitSize > 0) {
      const [lazyBitSize, url] = await getUrlSize(getImageBitSize, urlList)
      if (lazyBitSize === -1) return null
      if (lazyBitSize > 0 && lazyBitSize >= bitSize) {
        if (lazyBitSize === bitSize && getRawUrl(currentSrc) === getRawUrl(url)) return null
        badImageList.add(currentSrc)
        return url
      }
    }
    const [lazyRealSize, url] = await getUrlSize(getImageRealSize, urlList)
    if (lazyRealSize > 0 && lazyRealSize >= naturalSize) {
      if (lazyRealSize === naturalSize && getRawUrl(currentSrc) === getRawUrl(url)) return null
      badImageList.add(currentSrc)
      return url
    }
    return null
  }
  async function processAttribute(attr, currentSrc, bitSize, naturalSize) {
    const match = [...attr.value.matchAll(urlRegex)]
    if (match.length === 0) return null

    if (match.length === 1) {
      if (match[0][0] === currentSrc) return null
      const newURL = match[0][0].replace(/https?:/, protocol)
      return await getBetterUrl(currentSrc, bitSize, naturalSize, newURL)
    }

    if (match.length > 1) {
      const first = match[0][0].replace(/https?:/, protocol)
      const last = match[match.length - 1][0].replace(/https?:/, protocol)
      return await getBetterUrl(currentSrc, bitSize, naturalSize, first, last)
    }
  }
  async function checkImageAttr(img, attrList) {
    const successList = []
    let lastIndex = 0
    let complete = false
    while (!complete) {
      // init var for current url and size
      const currentSrc = img.currentSrc
      const realSrc = currentSrc.replace(/https?:/, protocol)
      const [bitSize, naturalSize] = await Promise.all([getImageBitSize(realSrc), getImageRealSize(realSrc)])

      // loop thought remaining attr
      while (lastIndex < attrList.length) {
        const attr = attrList[lastIndex++]
        complete = lastIndex === attrList.length
        const betterUrl = await processAttribute(attr, currentSrc, bitSize, naturalSize)
        if (betterUrl !== null) {
          const realAttrName = attr.name.startsWith('raw ') ? attr.name.slice(4) : attr.name
          img.removeAttribute(realAttrName)
          successList.push(attr.name)
          await updateImageSource(img, betterUrl)
          break
        }
      }
    }
    return successList
  }

  // unlazy main function
  function getUnlazyAttrList(img) {
    const rawUrl = getRawUrl(img.currentSrc)
    const attrList = []
    for (const attr of img.attributes) {
      if (passList.has(attr.name) || !attr.value.match(urlRegex)) continue

      const attrUrl = new URL(attr.value, document.baseURI).href
      if (attrUrl !== img.currentSrc) {
        attrList.push({name: attr.name, value: attrUrl})
      }
      const rawAttrUrl = getRawUrl(attrUrl)
      if (rawAttrUrl !== attrUrl && rawAttrUrl !== rawUrl) {
        attrList.push({name: 'raw ' + attr.name, value: rawAttrUrl})
      }
    }
    if (img.srcset && img.srcset !== img.currentSrc) {
      const srcsetList = img.srcset.split(', ').map(str => str.split(' ')[0])
      if (srcsetList.length === 1) {
        attrList.push({name: 'srcset', value: srcsetList[0]})
      } else {
        attrList.push({name: 'srcset-first', value: srcsetList[0]})
        attrList.push({name: 'srcset-last', value: srcsetList[srcsetList.length - 1]})
      }
    }
    if (rawUrl !== img.currentSrc) {
      attrList.push({name: 'raw url', value: rawUrl})
    }
    const filename = img.currentSrc.split('/').pop()
    if (!filename.includes('.')) {
      const extMatch = filename.match(/jpeg|jpg|png|gif|webp|bmp|tiff|avif/)
      if (extMatch) {
        const filenameWithExt = filename.split('?').shift() + '.' + extMatch[0]
        const rawExt = img.currentSrc.replace(filename, filenameWithExt)
        attrList.push({name: 'raw extension', value: rawExt})
      }
    }
    const anchor = img.closest('a')
    if (anchor && anchor.href !== img.currentSrc) {
      const anchorHaveExt = cachedExtensionMatch(anchor.href) !== null
      const rawHaveExt = cachedExtensionMatch(rawUrl) !== null
      const maybeLarger = anchorHaveExt || anchorHaveExt === rawHaveExt || rawUrl.slice(0, 12).includes('cdn.')
      if (maybeLarger) attrList.push({name: 'parent anchor', value: anchor.href})
    }
    return attrList
  }
  function getUnlazyImageList(minWidth, minHeight) {
    const imgWithAttrList = []
    let allComplete = true
    for (const img of document.querySelectorAll('img:not(.simpleUnlazy)')) {
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
      let lazyClass = false
      for (const className of img.classList) {
        if (isLazyClass(className)) {
          lazyClass = true
          img.classList.remove(className)
        }
      }
      if (lazyClass) {
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
  async function startUnlazy(minWidth, minHeight) {
    const {imgWithAttrList, allComplete} = getUnlazyImageList(minWidth, minHeight)
    const listSize = imgWithAttrList.length
    if (listSize === 0) return allComplete

    console.log(`Try to unlazy ${listSize} image`)
    imgWithAttrList.forEach(item => item[0].classList.add('simpleUnlazy', 'unlazyNotComplete'))

    const asyncList = await Promise.all(imgWithAttrList.map(([img, attrList]) => checkImageAttr(img, attrList)))
    imgWithAttrList.forEach(item => item[0].classList.remove('unlazyNotComplete'))
    const lazyList = asyncList.flat()

    if (lazyList.length > listSize) console.log('Multiple unlazy attributes found')
    const lazySet = new Set(lazyList)
    for (const name of lazySet) {
      console.log(`Unlazy ${lazyList.filter(x => x === name).length} img with ${name}`)
    }

    return false
  }
  function clearWindowBackup(options) {
    const allImageUrlSet = new Set(getImageListWithoutFilter(options).map(data => data[0]))
    const backup = window.backupImageUrlList
    for (let i = backup.length - 1; i >= 0; i--) {
      const url = backup[i]
      if (typeof url !== 'string') continue
      if (!allImageUrlSet.has(url)) backup.splice(i, 1)
    }
  }
  function createFirstUnlazyRace(options) {
    // slow connection alert
    setTimeout(() => {
      if (firstUnlazyCompleteFlag) return
      const unlazyList = document.querySelectorAll('img:not(.simpleUnlazy)')
      const stillLoading = [...unlazyList].some(img => !img.complete && img.loading !== 'lazy')
      if (stillLoading) {
        console.log('Slow connection, images still loading')
        alert('Slow connection, images still loading')
      }
    }, 10000)

    // set timeout for first unlazy
    const timeout = new Promise(resolve =>
      setTimeout(() => {
        resolve()
        if (!firstUnlazyCompleteFlag) {
          console.log('Unlazy timeout')
        }
      }, 1000)
    )
    const clone = structuredClone(options)
    clone.firstTime = true
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
  async function simpleUnlazyImage(options) {
    if (firstUnlazyFlag) {
      firstUnlazyFlag = false
      preprocessLazyPlaceholder()
      fakeUserHover()
      const race = createFirstUnlazyRace(options)
      return race
    }
    // wait first unlazy complete
    if (!options.firstTime && !firstUnlazyCompleteFlag) {
      while (!firstUnlazyCompleteFlag) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    const minWidth = Math.min(options.minWidth, 100)
    const minHeight = Math.min(options.minHeight, 100)

    let allComplete = await startUnlazy(minWidth, minHeight)
    while (!allComplete) {
      await new Promise(resolve => setTimeout(resolve, 100))
      allComplete = await startUnlazy(minWidth, minHeight)
    }

    if (!firstUnlazyCompleteFlag) {
      console.log('First unlazy complete')
      firstUnlazyCompleteFlag = true
      clearWindowBackup(options)
      if (typeof ImageViewer === 'function') ImageViewer('clear_image_list')
    }
    if (autoScrollFlag) {
      ImageViewer('clear_image_list')
    }
    if (lastHref !== '' && lastHref !== location.href) {
      const unchangedCount = [...new Set(getImageListWithoutFilter(options).map(data => data[0]))].map(url => window.backupImageUrlList.indexOf(url)).filter(i => i !== -1).length
      if (unchangedCount < 5) {
        window.backupImageUrlList = []
        ImageViewer('reset_image_list')
      }
    }
    lastHref = location.href

    isEnabledAutoScroll(options) ? autoScroll() : scrollUnlazy()
  }

  // get image
  function processImageDataList(options, imageDataList) {
    const isBadImage = options.svgFilter ? url => badImageList.has(url) || url.startsWith('data:image/svg') || url.includes('.svg') : url => badImageList.has(url)

    const filteredDataList = imageDataList.filter(data => !isBadImage(data[0]))

    let imageUrlSet = new Set(filteredDataList.map(data => data[0]))
    const imageUrlOrderedList = [...imageUrlSet]
    for (const data of filteredDataList) {
      const url = data[0]
      const rawUrl = getRawUrl(url)
      if (url !== rawUrl && imageUrlSet.has(rawUrl)) {
        const urlIndex = imageUrlOrderedList.indexOf(url)
        const rawUrlIndex = imageUrlOrderedList.indexOf(rawUrl)
        if (urlIndex === -1) continue
        // ensure the order unchanged
        if (urlIndex > rawUrlIndex) {
          imageUrlSet.delete(url)
          imageUrlOrderedList.splice(urlIndex, 1)
        } else {
          data[0] = rawUrl
          imageUrlOrderedList[urlIndex] = imageUrlOrderedList[rawUrlIndex]
          imageUrlOrderedList.splice(rawUrlIndex, 1)
          imageUrlSet = new Set(imageUrlOrderedList)
        }
      }
    }

    const uniqueDataList = []
    for (const data of filteredDataList) {
      const url = data[0]
      if (imageUrlSet.has(url)) {
        imageUrlSet.delete(url)
        uniqueDataList.push(data)
      }
    }

    return uniqueDataList
  }
  // function getShadowRootHolderList() {
  //   const shadowRootHolderList = [...document.body.querySelectorAll('*:not([no-shadow])')]
  //   for (let i = shadowRootHolderList.length - 1; i >= 0; i--) {
  //     const node = shadowRootHolderList[i]
  //     if (!node?.shadowRoot || node.shadowRoot.querySelectorAll('img').length === 0) {
  //       node.setAttribute('no-shadow', '')
  //       shadowRootHolderList.splice(i, 1)
  //     }
  //   }
  //   return shadowRootHolderList
  // }
  function getImageListWithoutFilter(options) {
    const imageDataList = []

    const rawImageList = [...document.querySelectorAll('img.simpleUnlazy')]
    for (const img of rawImageList) {
      const imgSrc = img.currentSrc || img.src
      imageDataList.push([imgSrc, img])
    }

    // const shadowRootHolderList = getShadowRootHolderList()
    // for (const node of shadowRootHolderList) {
    //   const imageList = node.shadowRoot.querySelectorAll('img')
    //   for (const img of imageList) {
    //     const imgSrc = img.currentSrc || img.src
    //     imageDataList.push([imgSrc, node])
    //   }
    // }

    const uncheckedNodeList = document.body.querySelectorAll('*:not([no-bg])')
    for (const node of uncheckedNodeList) {
      const attrUrl = node.getAttribute('data-bg')
      if (attrUrl !== null) {
        imageDataList.push([attrUrl, node])
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
        imageDataList.push([url, node])
      }
    }

    const videoList = document.querySelectorAll('video[poster]')
    for (const video of videoList) {
      imageDataList.push([video.poster, video])
    }

    const uniqueDataList = processImageDataList(options, imageDataList)
    return uniqueDataList
  }
  function isNodeSizeEnough(node, minWidth, minHeight) {
    const widthAttr = node.getAttribute('data-width')
    if (widthAttr) {
      const heightAttr = node.getAttribute('data-height')
      const width = Number(widthAttr)
      const height = Number(heightAttr)
      return width >= minWidth && height >= minHeight
    } else {
      const {width, height} = node.getBoundingClientRect()
      if (width === 0 || height === 0) {
        node.setAttribute('no-bg', '')
        return false
      }
      node.setAttribute('data-width', width)
      node.setAttribute('data-height', height)
      return width >= minWidth && height >= minHeight
    }
  }
  async function getImageList(options) {
    const minWidth = options.minWidth
    const minHeight = options.minHeight
    if (minWidth === 0 && minHeight === 0) {
      return getImageListWithoutFilter(options)
    }

    const imageDataList = []

    const rawImageList = [...document.querySelectorAll('img.simpleUnlazy')]
    for (const img of rawImageList) {
      // only client size should be checked in order to bypass large icon or hidden image
      const {width, height} = img.getBoundingClientRect()
      if ((width >= minWidth && height >= minHeight) || img.classList.contains('ImageViewerLastDom')) {
        // currentSrc might be empty during unlazy or update
        const imgSrc = img.currentSrc || img.src
        imageDataList.push([imgSrc, img])
      }
    }

    // const shadowRootHolderList = getShadowRootHolderList()
    // for (const node of shadowRootHolderList) {
    //   const imageList = node.shadowRoot.querySelectorAll('img')
    //   for (const img of imageList) {
    //     // only client size should be checked in order to bypass large icon or hidden image
    //     const {width, height} = img.getBoundingClientRect()
    //     if ((width >= minWidth && height >= minHeight) || img.classList.contains('ImageViewerLastDom')) {
    //       // currentSrc might be empty during unlazy or update
    //       const imgSrc = img.currentSrc || img.src
    //       imageDataList.push([imgSrc, node])
    //     }
    //   }
    // }

    const uncheckedNodeList = document.body.querySelectorAll('*:not([no-bg])')
    for (const node of uncheckedNodeList) {
      if (!isNodeSizeEnough(node, minWidth, minHeight)) continue
      const attrUrl = node.getAttribute('data-bg')
      if (attrUrl !== null) {
        imageDataList.push([attrUrl, node])
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
          if (realSize >= minWidth && realSize >= minHeight) imageDataList.push([url, node])
        } else {
          imageDataList.push([url, node])
        }
      }
    }

    const videoList = document.querySelectorAll('video[poster]')
    for (const video of videoList) {
      const {width, height} = video.getBoundingClientRect()
      if (width >= minWidth && height >= minHeight) {
        imageDataList.push([video.poster, video])
      }
    }

    const uniqueDataList = processImageDataList(options, imageDataList)
    return uniqueDataList
  }

  // sort image list
  async function mapSrcToIframe(dataList) {
    const iframeList = [...document.getElementsByTagName('iframe')]
    const iframeSrcList = iframeList.map(iframe => iframe.src)
    const filteredList = iframeSrcList.filter(src => src !== '' && src !== 'about:blank')
    if (filteredList.length === 0) return dataList

    const iframeRedirectSrcList = (await safeSendMessage({msg: 'get_redirect', data: iframeSrcList})) || []

    const imageDomList = []
    for (const data of dataList) {
      const iframeSrc = data[1]
      if (typeof iframeSrc === 'string') {
        const index = iframeRedirectSrcList.indexOf(iframeSrc)
        if (index !== -1) {
          imageDomList.push([data[0], iframeList[index]])
        }
      } else {
        imageDomList.push(data)
      }
    }
    return imageDomList
  }
  async function sortImageDataList(dataList) {
    const imageDomList = await mapSrcToIframe(dataList)
    const bitMask = Node.DOCUMENT_POSITION_FOLLOWING
    imageDomList.sort((a, b) => (a[1].compareDocumentPosition(b[1]) & bitMask ? -1 : 1))

    const sortedDataList = []
    for (const [url, dom] of imageDomList) {
      if (dom.tagName === 'IFRAME') {
        sortedDataList.push([url, dom.src])
      } else {
        sortedDataList.push(url)
      }
    }
    return sortedDataList
  }

  // combine image list
  function removeRepeatNonRaw(newList, oldList) {
    const tempList = newList.concat(oldList)
    const tempImageUrlSet = new Set(tempList.map(data => (typeof data === 'string' ? data : data[0])))
    for (const url of tempList) {
      if (typeof url !== 'string') continue
      const rawUrl = getRawUrl(url)
      if (url !== rawUrl && tempImageUrlSet.has(rawUrl)) tempImageUrlSet.delete(url)
    }

    for (let i = 0; i < newList.length; i++) {
      const url = newList[i]
      if (typeof url !== 'string') continue
      const rawUrl = getRawUrl(url)
      if (url !== rawUrl && tempImageUrlSet.has(rawUrl)) {
        newList[i] = rawUrl
      }
    }

    for (let i = 0; i < oldList.length; i++) {
      const url = oldList[i]
      if (typeof url !== 'string') continue
      const rawUrl = getRawUrl(url)
      if (url !== rawUrl && tempImageUrlSet.has(rawUrl)) {
        oldList[i] = rawUrl
      }
    }
  }

  // auto scroll
  function startAutoScroll() {
    let stopFlag = true
    const getStopFlag = () => stopFlag
    const action = () => {
      let currBottom = 0
      let bottomImg = null
      for (const img of document.getElementsByTagName('img')) {
        const {bottom} = img.getBoundingClientRect()
        if (bottom > currBottom) {
          currBottom = bottom
          bottomImg = img
        }
      }

      if (!isImageViewerExist()) return
      bottomImg.scrollIntoView({behavior: 'instant', block: 'start'})
    }
    const timer = async () => {
      stopFlag = false
      const container = getMainContainer()
      let lastY = container.scrollTop
      let count = 0
      while (lastY < container.scrollHeight) {
        if (count > 5 || !isImageViewerExist()) break

        while (document.visibilityState !== 'visible' || !document.documentElement.classList.contains('enableAutoScroll')) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }

        await mutex.waitUnlock()
        action()
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
    return {getStopFlag, timer}
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

    const {getStopFlag, timer} = startAutoScroll()

    let existNewDom = false
    const newNodeObserver = new MutationObserver(() => {
      existNewDom = true
      if (getStopFlag()) timer()
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

  return {
    updateWrapperSize: function (dom, domSize, options) {
      const tagName = dom?.tagName
      if (tagName !== 'IMG' && tagName !== 'DIV') {
        options.sizeCheck = true
        return
      }
      const [domWidth, domHeight] = domSize
      if (!dom || !document.contains(dom) || domWidth === 0) return

      // div
      if (tagName === 'DIV') {
        const selector = getDomSelector(dom)
        updateSizeBySelector(domWidth, domHeight, document, selector, options)
        return
      }

      // image
      const wrapper = dom.closest('div')
      const classList = wrapper ? '.' + [...wrapper?.classList].map(CSS.escape).join(', .') : ''
      const wrapperDivList = wrapper ? document.querySelectorAll(`div:is(${classList}):has(img):not(:has(div img))`) : []

      if (!wrapper || wrapperDivList.length <= 1) {
        const selector = getDomSelector(dom)
        updateSizeBySelector(domWidth, domHeight, document, selector, options)
        return
      }
      if (wrapper.classList.length === 0) {
        updateSizeBySelector(domWidth, domHeight, wrapper, 'img', options)
        return
      }
      updateSizeByWrapper(wrapperDivList, domWidth, domHeight, options)
    },

    getOrderedImageUrls: async function (options, retryCount = 0) {
      const release = await mutex.acquire()

      await simpleUnlazyImage(options)

      const uniqueImageUrls = await getImageList(options)

      const iframeList = [...document.getElementsByTagName('iframe')]
      const iframeSrcList = iframeList.map(iframe => iframe.src)
      const filteredList = iframeSrcList.filter(src => src !== '' && src !== 'about:blank')
      if (filteredList.length) {
        const minSize = Math.min(options.minWidth, options.minHeight)
        const iframeImage = (await safeSendMessage({msg: 'extract_frames', minSize: minSize})) || []

        const uniqueIframeImage = []
        const uniqueIframeImageUrls = new Set()
        for (const img of iframeImage) {
          if (!uniqueIframeImageUrls.has(img[0])) {
            uniqueIframeImageUrls.add(img[0])
            uniqueIframeImage.push(img)
          }
        }
        uniqueImageUrls.push(...uniqueIframeImage)
      }

      if (uniqueImageUrls.length === 0) {
        release()
        if (retryCount < 3) {
          const retryResult = await new Promise(resolve => setTimeout(() => resolve(this.getOrderedImageUrls(options, retryCount + 1)), 1000))
          return retryResult
        }
        console.log('Found no image')
        return []
      }

      const orderedImageUrls = await sortImageDataList(uniqueImageUrls)

      release()
      return orderedImageUrls
    },

    searchImageInfoIndex: function (input, imageList) {
      if (typeof input === 'object') {
        const currentUrl = getDomUrl(input)
        const currIndex = imageList.indexOf(currentUrl)
        if (currIndex !== -1) return currIndex

        // handle url update lag
        // init large quantity cause lag, index should near end
        const rawUrl = getRawUrl(currentUrl)
        for (let i = imageList.length - 1; i >= 0; i--) {
          const url = imageList[i]
          if (typeof url === 'string' && url.startsWith(rawUrl)) {
            return i
          }
        }

        return -1
      }

      return getImageInfoIndex(imageList, input)
    },

    combineImageList: function (newList, oldList) {
      oldList = oldList.filter(data => {
        const src = typeof data === 'string' ? data : data[0]
        return !badImageList.has(src)
      })
      if (newList.length === 0 || oldList.length === 0) return newList.concat(oldList)

      removeRepeatNonRaw(newList, oldList)

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

        indexAtOldArray = getImageInfoIndex(oldList, right)
        indexAtCombinedArray = getImageInfoIndex(combinedImageList, right)

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
        const url = typeof data === 'string' ? data : data[0]
        if (!imageUrlSet.has(url)) {
          imageUrlSet.add(url)
          uniqueFinalList.push(data)
        }
      }
      return uniqueFinalList
    },

    isStrLengthEqual: function (newList, oldList) {
      const newListStringLength = newList
        .flat()
        .map(str => str.length)
        .reduce((a, b) => a + b, 0)
      const oldListStringLength = oldList
        .flat()
        .map(str => str.length)
        .reduce((a, b) => a + b, 0)

      return newListStringLength === oldListStringLength
    },

    getMainContainer: getMainContainer
  }
})()
