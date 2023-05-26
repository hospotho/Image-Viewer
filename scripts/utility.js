const ImageViewerUtils = (function () {
  'use strict'

  const passList = new Set(['class', 'style', 'src', 'alt', 'title', 'loading', 'crossorigin', 'height', 'width', 'sizes', 'onerror', 'data-error'])
  const urlRegex = /(?:https?:\/)?\/\S+/g
  const argsRegex = /(.*?(?:png|jpeg|jpg|gif|bmp|tiff|webp)).*/i
  const protocol = window.location.protocol
  const srcBitSizeMap = new Map()
  const srcRealSizeMap = new Map()
  const mutex = (() => {
    let promise = Promise.resolve()
    let busy = false
    return {
      acquire: async () => {
        await promise
        let release
        promise = new Promise(
          resolve =>
            (release = () => {
              busy = false
              resolve()
            })
        )
        busy = true
        return release
      },
      isBusy: () => busy
    }
  })()
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

  function getRawUrl(src) {
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
  function getImageBitSize(src) {
    if (!src || src === 'about:blank' || src.startsWith('data')) return 0

    const cache = srcBitSizeMap.get(src)
    if (cache !== undefined) return cache

    return new Promise(_resolve => {
      const resolve = size => {
        srcBitSizeMap.set(src, size)
        _resolve(size)
      }

      let complete = false
      const updateComplete = () => {
        !complete ? (complete = true) : resolve(0)
      }

      // protocol-relative URL
      const url = new URL(src, document.baseURI)
      const href = url.href

      if (url.hostname !== location.hostname) {
        chrome.runtime.sendMessage({msg: 'get_size', url: href}).then(reply => {
          reply ? resolve(reply) : updateComplete()
        })
      }

      try {
        fetch(href, {method: 'HEAD'})
          .then(res => {
            if (!res.ok) {
              updateComplete()
              return
            }
            const type = res.headers.get('Content-Type')
            const length = res.headers.get('Content-Length')
            if (type?.startsWith('image')) {
              const size = parseInt(length)
              size ? resolve(size) : updateComplete()
            }
          })
          .catch(updateComplete)
      } catch (error) {
        updateComplete()
      }
    })
  }
  function getImageRealSize(src) {
    const cache = srcRealSizeMap.get(src)
    if (cache !== undefined) return cache

    return new Promise(_resolve => {
      const resolve = size => {
        srcBitSizeMap.set(src, size)
        _resolve(size)
      }

      const img = new Image()
      img.onload = () => resolve(img.naturalWidth)
      img.onerror = () => resolve(0)
      img.src = src
    })
  }
  function updateImageSource(img, src) {
    return new Promise(resolve => {
      async function checkSrc() {
        const srcUrl = new URL(img.src, document.baseURI)
        while (srcUrl.href !== img.currentSrc) {
          await new Promise(resolve => setTimeout(resolve, 20))
        }
        resolve()
      }

      img.src = src
      img.srcset = src

      const picture = img.parentNode
      if (picture?.tagName === 'PICTURE') {
        const sources = picture.querySelectorAll('source')
        for (const source of sources) {
          source.srcset = src
        }
      }

      checkSrc()
    })
  }
  async function checkUrlSize(img, size, getSizeFunction, url) {
    if (url.length === 1) {
      const lazySize = await getSizeFunction(url[0])
      if (lazySize > size) {
        await updateImageSource(img, url[0])
        return true
      }
    } else if (url.length === 2) {
      const [firstSize, lastSize] = await Promise.all(url.map(getSizeFunction))
      if (firstSize > size || lastSize > size) {
        const large = lastSize > firstSize ? url[1] : url[0]
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
    img.loading = 'eager'

    const rawUrl = getRawUrl(img.currentSrc)
    const attrList = []
    for (const attr of img.attributes) {
      if (!passList.has(attr.name) && attr.value.match(urlRegex)) {
        attrList.push(attr)
      }
    }
    if (rawUrl === img.currentSrc && img.currentSrc === img.srcset && attrList.length === 0) return null

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
        if (isBetter) return attr.name
      }

      if (match.length > 1) {
        const first = match[0][0].replace(/https?:/, protocol)
        const last = match[match.length - 1][0].replace(/https?:/, protocol)
        const isBetter = await checkUrl(img, bitSize, naturalSize, first, last)
        if (isBetter) return attr.name
      }
    }

    return null
  }
  async function simpleUnlazyImage() {
    const unlazyList = [...document.querySelectorAll('img:not(.simpleUnlazy)')]

    const imgList = []
    for (const img of unlazyList) {
      const {width, height} = img.getBoundingClientRect()
      if (Math.min(width, height) >= 50) imgList.push(img)
    }
    const listSize = imgList.length
    if (!listSize) return

    console.log(`Try to unlazy ${listSize} image`)
    const asyncList = await Promise.all(imgList.map(checkImageAttr))
    const lazyName = asyncList.filter(Boolean)

    if (lazyName.length !== 0) {
      for (const name of [...new Set(lazyName)]) {
        console.log(`Unlazy ${lazyName.filter(x => x === name).length} img with ${name} attr`)
      }
    } else {
      console.log('No lazy image found')
    }

    unlazyList.map(img => img.classList.add('simpleUnlazy'))
  }

  function getImageListWithoutFilter(options) {
    const imageDataList = []
    for (const img of document.querySelectorAll('img.simpleUnlazy')) {
      imageDataList.push([img.currentSrc, img])
    }

    for (const node of document.querySelectorAll('*')) {
      const backgroundImage = window.getComputedStyle(node).backgroundImage
      if (backgroundImage === 'none') continue
      const bg = backgroundImage.split(', ')[0]
      if (bg.indexOf('url') === 0 && bg.indexOf('.svg') === -1) {
        imageDataList.push([bg.substring(4, bg.length - 1).replace(/['"]/g, ''), node])
      }
    }

    for (const video of document.querySelectorAll('video[poster]')) {
      imageDataList.push([video.poster, video])
    }

    const badImage = options.svgFilter ? url => url === '' || url === 'about:blank' || url.includes('.svg') : url => url === '' || url === 'about:blank'

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
    if (options.minWidth === 0 && options.minHeight === 0) {
      return getImageListWithoutFilter(options)
    }

    const imageDataList = []

    for (const img of document.querySelectorAll('img.simpleUnlazy')) {
      // only client size should be checked in order to bypass large icon or hidden image
      const {width, height} = img.getBoundingClientRect()
      if ((width >= options.minWidth && height >= options.minHeight) || img.classList.contains('ImageViewerLastDom')) {
        imageDataList.push([img.currentSrc, img])
      }
    }

    for (const node of document.querySelectorAll('*')) {
      const {width, height} = node.getBoundingClientRect()
      if (width < options.minWidth || height < options.minHeight) continue
      const backgroundImage = window.getComputedStyle(node).backgroundImage
      if (backgroundImage === 'none') continue
      const bg = backgroundImage.split(', ')[0]
      if (bg.indexOf('url') === 0 && bg.indexOf('.svg') === -1) {
        imageDataList.push([bg.substring(4, bg.length - 1).replace(/['"]/g, ''), node])
      }
    }

    for (const video of document.querySelectorAll('video[poster]')) {
      const {width, height} = video.getBoundingClientRect()
      if (width >= options.minWidth && height >= options.minHeight) {
        imageDataList.push([video.poster, video])
      }
    }

    const badImage = options.svgFilter ? url => url === '' || url === 'about:blank' || url.includes('.svg') : url => url === '' || url === 'about:blank'

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
  async function mapSrcToIframe(dataList) {
    const iframeList = [...document.getElementsByTagName('iframe')]
    if (iframeList.length === 0) return dataList

    const iframeSrcList = iframeList.map(iframe => iframe.src)
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
    for (const data of imageDomList) {
      const dom = data[1]
      if (dom.tagName === 'IFRAME') {
        sortedDataList.push([data[0], dom.src])
      } else {
        sortedDataList.push(data[0])
      }
    }
    return sortedDataList
  }

  function getDomUrl(dom) {
    const tag = dom.tagName
    if (tag === 'IMG') return dom.currentSrc
    if (tag === 'VIDEO') return dom.poster
    const backgroundImage = window.getComputedStyle(dom).backgroundImage
    const bg = backgroundImage.split(', ')[0]
    return bg.substring(4, bg.length - 1).replace(/['"]/g, '')
  }

  function getImageInfoIndex(array, data) {
    const srcArray = array.map(item => (typeof item === 'string' ? item : item[0]))
    const query = typeof data === 'string' ? data : data[0]
    const result = srcArray.indexOf(query)
    if (result !== -1) return result
    return srcArray.indexOf(getRawUrl(query))
  }

  function isEnableAutoScroll(options) {
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
    return enableAutoScroll
  }
  function stopAutoScrollOnExit(newNodeObserver, startX, startY) {
    let scrollFlag = false

    const originalScrollIntoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function () {
      scrollFlag = true
      let currX = window.scrollX
      let currY = window.scrollY
      originalScrollIntoView.apply(this, arguments)
      // for unknown reason can't move to correct position with single scroll
      while (currX !== window.scrollX || currY !== window.scrollY) {
        currX = window.scrollX
        currY = window.scrollY
        originalScrollIntoView.apply(this, arguments)
      }
      Element.prototype.scrollIntoView = originalScrollIntoView
    }

    const originalScrollTo = window.scrollTo
    window.scrollTo = function () {
      scrollFlag = true
      originalScrollTo.apply(this, arguments)
      window.scrollTo = originalScrollTo
    }

    const imageViewerObserver = new MutationObserver(() => {
      if (!document.documentElement.classList.contains('has-image-viewer')) {
        imageViewerObserver.disconnect()
        newNodeObserver.disconnect()
        setTimeout(() => {
          if (!scrollFlag) window.scrollTo(startX, startY)
          Element.prototype.scrollIntoView = originalScrollIntoView
          window.scrollTo = originalScrollTo
        }, 100)
      }
    })
    imageViewerObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['class']})
  }

  return {
    closeImageViewer: function () {
      document.documentElement.classList.remove('has-image-viewer')
      const viewer = document.querySelector('.__shadow__image-viewer')
      if (viewer) {
        viewer.addEventListener('transitionend', viewer.remove)
        viewer.style.transition = 'opacity 0.2s'
        viewer.style.opacity = '0'
      }
    },

    updateWrapperSize: function (dom, domSize, options) {
      if (!dom || domSize === 0) return

      const wrapper = dom.closest('div')
      if (!wrapper || wrapper.classList.length === 0) return

      const classList = '.' + [...wrapper.classList].map(CSS.escape).join(', .')
      const wrapperDivList = document.querySelectorAll(`div:is(${classList})`)

      const width = []
      const height = []
      for (const div of wrapperDivList) {
        // ad may use same wrapper and adblock set it to display: none
        if (div.offsetParent === null && div.style.position !== 'fixed') continue

        const imgList = [...div.querySelectorAll('img')]
        if (imgList.length === 0) continue

        const widthList = []
        const heightList = []
        for (const img of imgList) {
          const {width, height} = img.getBoundingClientRect()
          widthList.push(width)
          heightList.push(height)
        }
        const maxWidth = Math.max(...widthList)
        const maxHeight = Math.max(...heightList)
        width.push(maxWidth)
        height.push(maxHeight)
      }

      const finalWidth = Math.min(...width.filter(w => w * 2 >= domSize)) - 3
      const finalHeight = Math.min(...height.filter(h => h * 2 >= domSize)) - 3

      options.minWidth = Math.min(finalWidth, options.minWidth)
      options.minHeight = Math.min(finalHeight, options.minHeight)
    },

    getOrderedImageUrls: async function (options) {
      const release = await mutex.acquire()

      await simpleUnlazyImage()

      const uniqueImageUrls = getImageList(options)

      if (!!document.querySelector('iframe')) {
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
        return imageList.indexOf(getDomUrl(currentUrl))
      }

      const data = input.startsWith('data') ? [input] : input
      return getImageInfoIndex(imageList, data)
    },

    combineImageList: function (newList, oldList) {
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
      const imageUrlSet = new Set(finalList)

      for (const url of finalList) {
        const rawUrl = getRawUrl(url)
        if (url !== rawUrl && imageUrlSet.has(rawUrl)) imageUrlSet.delete(url)
      }

      const uniqueDataList = []
      for (const url of finalList) {
        if (imageUrlSet.has(url)) {
          imageUrlSet.delete(url)
          uniqueDataList.push(url)
        }
      }

      return uniqueDataList
    },

    checkAndStartAutoScroll: function (options) {
      if (!isEnableAutoScroll(options)) return

      const startX = window.scrollX
      const startY = window.scrollY
      const screenHeight = window.screen.height

      const period = 250
      let timeout
      const action = async () => {
        if (!document.documentElement.classList.contains('has-image-viewer')) return
        while (mutex.isBusy()) await new Promise(resolve => setTimeout(resolve, 50))
        window.scrollBy({top: screenHeight * 3, behavior: 'smooth'})
        if (window.scrollY + screenHeight * 3 < document.body.scrollHeight) {
          clearTimeout(timeout)
          timeout = setTimeout(action, period)
        }
      }
      timeout = setTimeout(action, period)

      let existNewDom = false
      const newNodeObserver = new MutationObserver(() => {
        existNewDom = true
        clearTimeout(timeout)
        timeout = setTimeout(action, period)
      })
      newNodeObserver.observe(document.documentElement, {childList: true, subtree: true})
      setTimeout(() => {
        if (!existNewDom) window.scrollTo(startX, document.body.scrollHeight)
      }, 3000)

      stopAutoScrollOnExit(newNodeObserver, startX, startY)
    }
  }
})()
