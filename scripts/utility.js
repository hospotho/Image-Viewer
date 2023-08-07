const ImageViewerUtils = (function () {
  'use strict'

  const passList = new Set(['class', 'style', 'src', 'srcset', 'alt', 'title', 'loading', 'crossorigin', 'height', 'width', 'sizes', 'onerror', 'data-error'])
  const urlRegex = /(?:https?:\/)?\/\S+/g
  const argsRegex = /(.*?[=\.](?:jpeg|jpg|png|gif|webp|bmp|tiff|avif))(?!\/)/i
  const protocol = window.location.protocol
  const srcBitSizeMap = new Map()
  const srcRealSizeMap = new Map()
  const mutex = (() => {
    let promise = Promise.resolve()
    let busy = false
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
        if (!busy) {
          let waitRelease = null
          const wait = new Promise(resolve => (waitRelease = resolve))

          const originalAcquire = this.acquire
          this.acquire = async () => {
            const lockRelease = await originalAcquire()
            waitRelease()
            this.acquire = originalAcquire
            return lockRelease
          }

          await wait
        }

        await promise
      }
    }
  })()

  let firstUnlazyFlag = true
  let firstUnlazyScrollFlag = false
  let firstSlowAlertFlag = false
  const unlazyObserver = new MutationObserver(mutationsList => {
    const updatedSet = new Set()
    const modifiedSet = new Set()
    for (const mutation of mutationsList) {
      const element = mutation.target
      if (element.classList.contains('updateByObserver')) {
        updatedSet.add(element)
        continue
      }
      if (element.classList.contains('simpleUnlazy')) {
        modifiedSet.add(element)
      }
    }
    for (const img of updatedSet) {
      img.classList.remove('updateByObserver')
    }
    for (const img of modifiedSet) {
      img.classList.add('updateByObserver')
      checkImageAttr(img)
    }
  })
  unlazyObserver.observe(document.documentElement, {attributes: true, subtree: true, attributeFilter: ['src', 'srcset']})

  // base function
  function getRawUrl(src) {
    if (src.startsWith('data')) return src
    const argsMatch = src.match(argsRegex)
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

  // unlazy
  async function scrollUnlazy(options, minWidth, minHeight) {
    if (isEnableAutoScroll(options)) return

    const release = await mutex.acquire()
    release()

    const currentX = window.scrollX
    const currentY = window.scrollY
    let domChanged = false
    const scrollObserver = new MutationObserver(mutationsList => {
      scrollObserver.disconnect()
      domChanged = true

      console.log('unlazy by scroll')
      let found = false
      for (const mutation of mutationsList) {
        const element = mutation.target
        if (!element.classList.contains('updateByObserver') || !element.classList.contains('simpleUnlazy')) {
          found = true
          break
        }
      }
      if (found) {
        const lazyList = []
        for (const container of document.body.getElementsByTagName('*')) {
          const {width, height} = container.getBoundingClientRect()
          if (width > minWidth && height > minHeight) lazyList.push(container)
        }

        const topList = []
        for (let i = 0; i < lazyList.length; i++) {
          const container = lazyList[i]
          const {top} = container.getBoundingClientRect()
          topList.push(top)
        }
        topList.sort((a, b) => a - b)

        const wrapper = (func, ...args) => {
          if (document.documentElement.classList.contains('has-image-viewer')) func(...args)
        }

        const screenHeight = window.screen.height
        const totalHeight = document.body.scrollHeight || document.documentElement.scrollHeight
        let lastTop = 0
        let scrollCount = 1
        for (let i = 0; i < topList.length; i++) {
          const top = topList[i]
          if (top > lastTop + screenHeight / 2 || i === topList.length - 1) {
            setTimeout(() => wrapper(window.scrollTo, currentX, top), scrollCount++ * 150)
            lastTop = top
          }
        }
        setTimeout(() => wrapper(window.scrollTo, currentX, totalHeight), scrollCount++ * 150)
        setTimeout(() => wrapper(window.scrollTo, currentX, currentY), scrollCount * 150)
        return
      }
      window.scrollTo(currentX, currentY)
    })

    scrollObserver.observe(document.documentElement, {
      attributes: true,
      subtree: true,
      childList: true,
      attributeFilter: ['src', 'srcset']
    })
    setTimeout(() => {
      scrollObserver.disconnect()
      if (!domChanged) window.scrollTo(currentX, currentY)
    }, 1000)
    window.scrollTo(0, 0)
    window.scrollBy({top: window.screen.height * 2})
  }
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
        const sources = picture.querySelectorAll('source')
        for (const source of sources) {
          source.srcset = src
        }
      }

      waitSrcUpdate(img, resolve)
    })
  }
  function getImageBitSize(src) {
    if (!src || src === 'about:blank' || src.startsWith('data')) return 0

    const cache = srcBitSizeMap.get(src)
    if (cache !== undefined) return cache

    return new Promise(async _resolve => {
      const resolve = size => {
        srcBitSizeMap.set(src, size)
        _resolve(size)
      }

      let complete = true
      const updateComplete = () => {
        !complete ? (complete = true) : resolve(0)
      }

      // protocol-relative URL
      const url = new URL(src, document.baseURI)
      const href = url.href

      if (url.hostname !== location.hostname) {
        complete = false
        chrome.runtime.sendMessage({msg: 'get_size', url: href}).then(reply => {
          reply ? resolve(reply) : updateComplete()
        })
      }

      try {
        const res = await fetch(href, {method: 'HEAD'})
        if (res.ok) {
          const type = res.headers.get('Content-Type')
          const length = res.headers.get('Content-Length')
          if (type?.startsWith('image') || (type === 'application/octet-stream' && href.match(argsRegex))) {
            const size = Number(length)
            size ? resolve(size) : updateComplete()
            return
          }
        }
      } catch (error) {}
      updateComplete()
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
  async function checkUrlSize(img, size, getSizeFunction, url) {
    if (url.length === 1) {
      const lazySize = await getSizeFunction(url[0])
      if (getSizeFunction.name === 'getImageBitSize' && lazySize === size) return false
      if (lazySize >= size) {
        await updateImageSource(img, url[0])
        return true
      }
    } else if (url.length === 2) {
      const [firstSize, lastSize] = await Promise.all(url.map(getSizeFunction))
      if (firstSize >= size || lastSize >= size) {
        const index = Number(lastSize > firstSize)
        const large = url[index]
        await updateImageSource(img, large)
        return true
      }
    }
    return false
  }
  async function checkUrl(img, bitSize, naturalSize, ...url) {
    if (bitSize) {
      const result = await checkUrlSize(img, bitSize, getImageBitSize, url)
      if (result) return result
    }
    const result = await checkUrlSize(img, naturalSize, getImageRealSize, url)
    return result
  }
  async function checkImageAttr(img) {
    const loadingType = img.loading
    img.loading = 'eager'
    if (loadingType === 'lazy') {
      await new Promise(resolve => {
        img.onload = resolve
        img.onerror = resolve
        if (img.complete) resolve()
      })
    }

    const rawUrl = getRawUrl(img.currentSrc)
    const attrList = []
    for (const attr of img.attributes) {
      if (!passList.has(attr.name) && attr.value.match(urlRegex)) {
        attrList.push(attr)
      }
    }
    if (img.srcset && img.currentSrc !== img.srcset) {
      attrList.push(img.attributes['srcset'])
    }
    if (rawUrl === img.currentSrc && attrList.length === 0) return null

    const bitSize = await getImageBitSize(img.currentSrc.replace(/https?:/, protocol))
    const naturalSize = img.naturalWidth

    if (rawUrl !== img.currentSrc) {
      const newURL = rawUrl.replace(/https?:/, protocol)
      const isBetter = await checkUrl(img, bitSize, naturalSize, newURL)
      if (isBetter) return 'rawUrl'
    }

    for (const attr of attrList) {
      const match = [...attr.value.matchAll(urlRegex)]
      if (match.length === 0) continue

      if (match.length === 1) {
        if (match[0][0] === img.currentSrc) continue
        const newURL = match[0][0].replace(/https?:/, protocol)
        const isBetter = await checkUrl(img, bitSize, naturalSize, newURL)
        if (isBetter) {
          img.removeAttribute(attr.name)
          return attr.name
        }
      }

      if (match.length > 1) {
        const first = match[0][0].replace(/https?:/, protocol)
        const last = match[match.length - 1][0].replace(/https?:/, protocol)
        const isBetter = await checkUrl(img, bitSize, naturalSize, first, last)
        if (isBetter) {
          img.removeAttribute(attr.name)
          return attr.name
        }
      }
    }

    return 'original src'
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
  async function simpleUnlazyImage(options) {
    // set timeout for first time unlazy
    if (firstUnlazyFlag) {
      firstUnlazyFlag = false
      const clone = structuredClone(options)
      clone.firstTime = true
      const timeout = new Promise(resolve =>
        setTimeout(() => {
          resolve()
          if (!firstUnlazyScrollFlag) {
            console.log('Unlazy timeout')
          }
        }, 1000)
      )
      const race = Promise.race([simpleUnlazyImage(clone), timeout])
      return race
    }
    // wait first unlazy complete
    while (!options.firstTime && !firstUnlazyScrollFlag) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    const unlazyList = document.querySelectorAll('img:not(.simpleUnlazy)')

    const minWidth = Math.min(options.minWidth, 100)
    const minHeight = Math.min(options.minHeight, 100)
    const imgList = []

    setTimeout(() => {
      if (!firstSlowAlertFlag && [...unlazyList].some(img => !img.complete && img.loading !== 'lazy')) {
        firstSlowAlertFlag = true
        alert('Slow connection, images still loading')
      }
    }, 5000)

    let allComplete = true
    for (const img of unlazyList) {
      // checkImageAttr() will fail if image is still loading
      if (!img.complete) {
        allComplete = false
        continue
      }
      const {width, height} = img.getBoundingClientRect()
      if ((width > minWidth && height > minHeight) || width === 0 || height === 0) imgList.push(img)
    }
    const listSize = imgList.length
    if (listSize) {
      console.log(`Try to unlazy ${listSize} image`)
      imgList.map(img => img.classList.add('simpleUnlazy'))

      const asyncList = await Promise.all(imgList.map(checkImageAttr))
      const lazyName = asyncList.filter(Boolean)

      if (lazyName.length !== 0) {
        for (const name of [...new Set(lazyName)]) {
          console.log(`Unlazy ${lazyName.filter(x => x === name).length} img with ${name}`)
        }
        // create dom update for observer manually
        const div = document.createElement('div')
        document.body.appendChild(div)
        setTimeout(() => div.remove(), 100)
      } else {
        console.log('No lazy image found')
      }
    }

    if (!allComplete) {
      await new Promise(resolve => setTimeout(resolve, 100))
      await simpleUnlazyImage(options)
    }

    if (!firstUnlazyScrollFlag) {
      console.log('First unlazy complete')
      clearWindowBackup(options)
      if (typeof imageViewer === 'function') imageViewer('clear')
      firstUnlazyScrollFlag = true
      if (document.readyState === 'complete') {
        setTimeout(() => scrollUnlazy(options, minWidth, minHeight), 500)
      } else {
        window.addEventListener('load', () => {
          setTimeout(() => scrollUnlazy(options, minWidth, minHeight), 500)
        })
      }
    }
  }

  // get image
  function getImageListWithoutFilter(options) {
    const imageDataList = []
    for (const img of document.querySelectorAll('img.simpleUnlazy')) {
      imageDataList.push([img.currentSrc, img])
    }

    for (const node of document.body.querySelectorAll('*:not([no-bg])')) {
      const backgroundImage = window.getComputedStyle(node).backgroundImage
      if (backgroundImage === 'none') {
        node.setAttribute('no-bg', '')
        continue
      }
      const bg = backgroundImage.split(', ')[0]
      if (bg.startsWith('url') && !bg.endsWith('.svg")')) {
        const url = bg.substring(5, bg.length - 2)
        imageDataList.push([url, node])
      }
    }

    for (const video of document.querySelectorAll('video[poster]')) {
      imageDataList.push([video.poster, video])
    }

    const badImage = options.svgFilter ? url => url === '' || url === 'about:blank' || url.includes('.svg') || url.includes('image/svg') : url => url === '' || url === 'about:blank'

    const filteredDataList = imageDataList.filter(data => !badImage(data[0]))
    const imageUrlSet = new Set(filteredDataList.map(data => data[0]))

    for (const data of filteredDataList) {
      const url = data[0]
      const rawUrl = getRawUrl(url)
      if (url !== rawUrl && imageUrlSet.has(rawUrl)) imageUrlSet.delete(url)
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
  function getImageList(options) {
    const minWidth = options.minWidth
    const minHeight = options.minHeight
    if (minWidth === 0 && minHeight === 0) {
      return getImageListWithoutFilter(options)
    }

    const imageDataList = []

    for (const img of document.querySelectorAll('img.simpleUnlazy')) {
      // only client size should be checked in order to bypass large icon or hidden image
      const {width, height} = img.getBoundingClientRect()
      if ((width >= minWidth && height >= minHeight) || img.classList.contains('ImageViewerLastDom')) {
        // currentSrc might be empty during unlazy or update
        const imgSrc = img.currentSrc || img.src
        imageDataList.push([imgSrc, img])
      }
    }

    for (const node of document.body.querySelectorAll('*:not([no-bg])')) {
      const widthAttr = node.getAttribute('data-width')
      if (widthAttr) {
        const heightAttr = node.getAttribute('data-height')
        const width = Number(widthAttr)
        const height = Number(heightAttr)
        if (width < minWidth || height < minHeight) continue
      } else {
        const {width, height} = node.getBoundingClientRect()
        if (width === 0 || height === 0) {
          node.setAttribute('no-bg', '')
          continue
        }
        node.setAttribute('data-width', width)
        node.setAttribute('data-height', height)
        if (width < minWidth || height < minHeight) continue
      }

      const backgroundImage = window.getComputedStyle(node).backgroundImage
      if (backgroundImage === 'none') {
        node.setAttribute('no-bg', '')
        continue
      }
      const bg = backgroundImage.split(', ')[0]
      if (bg.startsWith('url') && !bg.endsWith('.svg")')) {
        const url = bg.substring(5, bg.length - 2)
        imageDataList.push([url, node])
      }
    }

    for (const video of document.querySelectorAll('video[poster]')) {
      const {width, height} = video.getBoundingClientRect()
      if (width >= minWidth && height >= minHeight) {
        imageDataList.push([video.poster, video])
      }
    }

    const badImage = options.svgFilter ? url => url === '' || url === 'about:blank' || url.includes('.svg') || url.includes('image/svg') : url => url === '' || url === 'about:blank'

    const filteredDataList = imageDataList.filter(data => !badImage(data[0]))
    const imageUrlSet = new Set(filteredDataList.map(data => data[0]))

    for (const data of filteredDataList) {
      const url = data[0]
      const rawUrl = getRawUrl(url)
      if (url !== rawUrl && imageUrlSet.has(rawUrl)) imageUrlSet.delete(url)
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

  // sort image list
  async function mapSrcToIframe(dataList) {
    const iframeList = [...document.getElementsByTagName('iframe')]
    const iframeSrcList = iframeList.map(iframe => iframe.src)
    const filteredList = iframeSrcList.filter(src => src !== '' && src !== 'about:blank')
    if (filteredList.length === 0) return dataList

    const iframeRedirectSrcList = await chrome.runtime.sendMessage({msg: 'get_redirect', data: iframeSrcList})

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
    imageDomList.sort((a, b) => (a[1].compareDocumentPosition(b[1]) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))

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
  function isEnableAutoScroll(options) {
    if (document.documentElement.classList.contains('enableAutoScroll')) {
      return true
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
    const enableAutoScroll = domainList.includes(location.hostname.replace('www.', '')) || regexList.map(regex => regex.test(location.href)).filter(Boolean).length
    if (enableAutoScroll) document.documentElement.classList.add('enableAutoScroll')
    return enableAutoScroll
  }
  function stopAutoScrollOnExit(newNodeObserver, startX, startY) {
    let scrollFlag = false

    const originalScrollIntoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function () {
      if (!document.documentElement.classList.contains('has-image-viewer')) {
        scrollFlag = true
      }
      let currX = window.scrollX
      let currY = window.scrollY
      originalScrollIntoView.apply(this, arguments)
      // for unknown reason can't move to correct position with single scroll
      while (currX !== window.scrollX || currY !== window.scrollY) {
        currX = window.scrollX
        currY = window.scrollY
        originalScrollIntoView.apply(this, arguments)
      }
    }

    const originalScrollTo = window.scrollTo
    window.scrollTo = function () {
      if (!document.documentElement.classList.contains('has-image-viewer')) {
        scrollFlag = true
      }
      originalScrollTo.apply(this, arguments)
    }

    const imageViewerObserver = new MutationObserver(() => {
      if (!document.documentElement.classList.contains('has-image-viewer')) {
        imageViewerObserver.disconnect()
        newNodeObserver.disconnect()
        setTimeout(() => {
          if (!scrollFlag) window.scrollTo(startX, startY)
          Element.prototype.scrollIntoView = originalScrollIntoView
          window.scrollTo = originalScrollTo
        }, 500)
      }
    })
    imageViewerObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['class']})
  }

  // init function hotkey
  function checkKey(e, hotkey) {
    const keyList = hotkey.split('+').map(str => str.trim())
    const key = keyList[keyList.length - 1] === e.key.toUpperCase()
    const ctrl = keyList.includes('Ctrl') === e.ctrlKey
    const alt = keyList.includes('Alt') === e.altKey || e.getModifierState('AltGraph')
    const shift = keyList.includes('Shift') === e.shiftKey
    return key && ctrl && alt && shift
  }

  const options = window.ImageViewerOption
  window.addEventListener(
    'keydown',
    e => {
      // enable auto scroll
      if (checkKey(e, options.functionHotkey[0])) {
        e.preventDefault()
        if (!document.documentElement.classList.contains('enableAutoScroll')) {
          document.documentElement.classList.add('enableAutoScroll')
        }
        if (document.documentElement.classList.contains('has-image-viewer')) {
          ImageViewerUtils.checkAndStartAutoScroll(null)
        }
      }
      // download images
      if (typeof imageViewer === 'function' && checkKey(e, options.functionHotkey[1])) {
        e.preventDefault()
        chrome.runtime.sendMessage('download_images')
      }
    },
    true
  )

  return {
    closeImageViewer: function () {
      document.documentElement.classList.remove('has-image-viewer')
      const root = document.querySelector('#image-viewer-root')
      if (root) {
        root.addEventListener('transitionend', root.remove)
        root.style.transition = 'opacity 0.2s'
        root.style.opacity = '0'
      }
    },

    updateWrapperSize: function (dom, domSize, options) {
      const [domWidth, domHeight] = domSize
      if (!dom || !document.contains(dom) || domWidth === 0) return

      const wrapper = dom.closest('div')
      const classList = '.' + [...wrapper?.classList].map(CSS.escape).join(', .')
      const wrapperDivList = document.querySelectorAll(`div:is(${classList})`)
      // firefox not yet support :has()
      // const wrapperDivList = document.querySelectorAll(`div:is(${classList}):has(img):not(:has(div img))`)

      if (!wrapper || wrapperDivList.length === 1) {
        const img = dom
        let curr = img.parentElement
        let selector = 'img'
        while (curr.parentElement) {
          if (curr.classList.length > 1) {
            selector = curr.tagName.toLowerCase() + ':is(.' + [...curr.classList].map(CSS.escape).join(', .') + ') ' + selector
          } else if (curr.classList.length === 1) {
            selector = curr.tagName.toLowerCase() + '.' + CSS.escape(curr.classList[0]) + ' ' + selector
          } else {
            selector = curr.tagName.toLowerCase() + ' ' + selector
          }
          curr = curr.parentElement
        }

        let minWidth = domWidth
        let minHeight = domHeight
        for (const img of document.querySelectorAll(selector)) {
          const {width, height} = img.getBoundingClientRect()
          if (width !== 0 && height !== 0) {
            minWidth = Math.min(minWidth, width)
            minHeight = Math.min(minHeight, height)
          }
        }
        options.minWidth = Math.min(minWidth, options.minWidth)
        options.minHeight = Math.min(minHeight, options.minHeight)
        return
      }

      if (wrapper.classList.length === 0) {
        let minWidth = domWidth
        let minHeight = domHeight
        for (const img of wrapper.querySelectorAll('img')) {
          const {width, height} = img.getBoundingClientRect()
          if (width !== 0 && height !== 0) {
            minWidth = Math.min(minWidth, width)
            minHeight = Math.min(minHeight, height)
          }
        }
        options.minWidth = Math.min(minWidth, options.minWidth)
        options.minHeight = Math.min(minHeight, options.minHeight)
        return
      }

      const width = []
      const height = []
      for (const div of wrapperDivList) {
        // ad may use same wrapper and adblock set it to display: none
        if (div.offsetParent === null && div.style.position !== 'fixed') continue

        const imgList = div.querySelectorAll('img')
        if (imgList.length === 0) continue

        const widthList = []
        const heightList = []
        for (const img of imgList) {
          const {width, height} = img.getBoundingClientRect()
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
        width.push(maxWidth)
        height.push(maxHeight)
      }

      const [large, small] = domWidth / domHeight > 1 ? [domWidth, domHeight] : [domHeight, domWidth]
      const [optionLarge, optionSmall] = options.minWidth / options.minHeight > 1 ? [options.minWidth, options.minHeight] : [options.minHeight, options.minWidth]
      const finalWidth = Math.min(...width.filter(w => w * 1.5 >= large || w * 1.2 >= optionLarge)) - 3
      const finalHeight = Math.min(...height.filter(h => h * 1.5 >= small || h * 1.2 >= optionSmall)) - 3
      const finalSize = Math.min(finalWidth, finalHeight)

      options.minWidth = Math.min(finalSize, options.minWidth)
      options.minHeight = Math.min(finalSize, options.minHeight)
    },

    getOrderedImageUrls: async function (options, retryCount = 0) {
      const release = await mutex.acquire()

      await simpleUnlazyImage(options)

      const uniqueImageUrls = getImageList(options)

      const iframeList = [...document.getElementsByTagName('iframe')]
      const iframeSrcList = iframeList.map(iframe => iframe.src)
      const filteredList = iframeSrcList.filter(src => src !== '' && src !== 'about:blank')
      if (filteredList.length !== 0) {
        const minSize = Math.min(options.minWidth, options.minHeight)
        const iframeImage = await chrome.runtime.sendMessage({msg: 'extract_frames', minSize: minSize})

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
      }

      return getImageInfoIndex(imageList, input)
    },

    combineImageList: function (newList, oldList) {
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

    checkAndStartAutoScroll: async function (options) {
      if (!isEnableAutoScroll(options)) return

      while (!firstUnlazyScrollFlag) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      const startX = window.scrollX
      const startY = window.scrollY

      const imageListLength = imageViewer('get_image_list').length
      if (imageListLength > 50) {
        const totalHeight = document.body.scrollHeight || document.documentElement.scrollHeight
        window.scrollTo(startX, totalHeight * 0.85)
      }

      const period = 500
      let stopFlag = true
      const action = async () => {
        await mutex.waitUnlock()

        const allImage = document.getElementsByTagName('img')
        let currBottom = 0
        let bottomImg = null
        for (const img of allImage) {
          const {bottom} = img.getBoundingClientRect()
          if (bottom > currBottom) {
            currBottom = bottom
            bottomImg = img
          }
        }

        if (!document.documentElement.classList.contains('has-image-viewer')) return
        bottomImg.scrollIntoView({block: 'start'})
        await new Promise(resolve => setTimeout(resolve, period))
      }
      const timer = async () => {
        stopFlag = false
        let lastY = window.scrollY
        let count = 0
        while (lastY < (document.body.scrollHeight || document.documentElement.scrollHeight)) {
          if (count > 5 || !document.documentElement.classList.contains('has-image-viewer')) break

          if (document.visibilityState !== 'visible') {
            while (document.visibilityState !== 'visible') {
              await new Promise(resolve => setTimeout(resolve, 100))
            }
          }

          await action()
          if (lastY === window.scrollY) {
            count++
            window.scrollBy(0, -100)
            window.scrollBy({top: window.screen.height})
          } else {
            count = 0
          }
          lastY = window.scrollY
        }
        stopFlag = true
      }

      timer()

      let existNewDom = false
      const newNodeObserver = new MutationObserver(() => {
        existNewDom = true
        if (stopFlag) timer()
      })
      newNodeObserver.observe(document.documentElement, {childList: true, subtree: true})
      setTimeout(() => {
        if (!existNewDom) {
          const totalHeight = document.body.scrollHeight || document.documentElement.scrollHeight
          window.scrollTo(startX, totalHeight)
        }
      }, 3000)

      stopAutoScrollOnExit(newNodeObserver, startX, startY)
    }
  }
})()
