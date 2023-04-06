const ImageViewerUtils = (function () {
  const passList = ['class', 'style', 'src', 'alt', 'title', 'loading', 'crossorigin', 'height', 'width', 'sizes', 'onerror']
  const urlRegex = /(?:https?:\/)?\/\S+/g
  const argsRegex = /(.+\/.*?\.).*(png|jpeg|jpg|gif|bmp|tiff|webp).*/i
  const protocol = window.location.protocol
  const srcBitSizeMap = new Map()

  async function getImageBitSize(src) {
    if (!src || src === 'about:blank' || src.startsWith('data')) return 0

    const cache = srcBitSizeMap.get(src)
    if (cache !== undefined) return cache

    // protocol-relative URL
    const url = src.startsWith('//') ? protocol + src : src

    if (new URL(url).hostname !== location.hostname) {
      return chrome.runtime.sendMessage({msg: 'get_size', url: url})
    }

    try {
      const res = await fetch(url, {method: 'HEAD'})
      if (res.ok) {
        const type = res.headers.get('Content-Type')
        const length = res.headers.get('Content-Length')
        if (type?.startsWith('image')) {
          const size = parseInt(length) || 0
          srcBitSizeMap.set(src, size)
          return size
        }
      }
    } catch (error) {}

    return 0
  }
  function getImageRealSize(src) {
    return new Promise(resolve => {
      const img = new Image()
      img.onload = () => resolve(img.naturalWidth)
      img.onerror = () => resolve(0)
      img.src = src
      setTimeout(() => resolve(0), 1000)
    })
  }
  function updateImageSource(img, src) {
    img.src = src
    img.srcset = src

    const picture = img.parentNode
    if (picture.tagName !== 'PICTURE') return
    const sources = picture.querySelectorAll('source')
    for (const source of sources) {
      source.srcset = src
    }
  }
  async function checkImageAttr(img) {
    img.loading = 'eager'

    const argsMatch = !img.src.startsWith('data') && img.src.match(argsRegex)
    const attrList = [...img.attributes].filter(attr => !passList.includes(attr.name) && attr.value.match(urlRegex))
    if (!argsMatch && attrList.length === 0) return ''

    const bitSize = await getImageBitSize(img.src.replace(/https?:/, protocol))
    const naturalSize = img.naturalWidth

    const rawUrl = argsMatch?.[1] + argsMatch?.[2]
    if (argsMatch && rawUrl !== img.src) {
      const newURL = rawUrl.replace(/https?:/, protocol)
      if (bitSize) {
        const lazySize = await getImageBitSize(newURL)
        if (lazySize > bitSize) {
          updateImageSource(img, newURL)
          return 'rawUrl'
        }
      }

      const lazySize = await getImageRealSize(newURL)
      if (lazySize > naturalSize) {
        updateImageSource(img, newURL)
        return 'rawUrl'
      }
    }

    for (const attr of attrList) {
      const match = [...attr.value.matchAll(urlRegex)]
      if (match.length === 0) continue
      if (match[0][0] === img.src) continue

      if (match.length === 1) {
        const newURL = match[0][0].replace(/https?:/, protocol)
        if (bitSize) {
          const lazySize = await getImageBitSize(newURL)
          if (lazySize > bitSize) {
            updateImageSource(img, newURL)
            return attr.name
          }
        }

        const lazySize = await getImageRealSize(newURL)
        if (lazySize > naturalSize) {
          updateImageSource(img, newURL)
          return attr.name
        }
      }

      if (match.length > 1) {
        const first = match[0][0].replace(/https?:/, protocol)
        const last = match[match.length - 1][0].replace(/https?:/, protocol)
        if (bitSize) {
          const [firstSize, lastSize] = await Promise.all([first, last].map(getImageBitSize))
          if (firstSize > bitSize || lastSize > bitSize) {
            const large = lastSize > firstSize ? last : first
            updateImageSource(img, large)
            return attr.name
          }
        }

        const [firstSize, lastSize] = await Promise.all([first, last].map(getImageRealSize))
        if (firstSize > naturalSize || lastSize > naturalSize) {
          const large = lastSize > firstSize ? last : first
          updateImageSource(img, large)
          return attr.name
        }
      }
    }
  }
  async function simpleUnlazyImage() {
    const unlazyList = [...document.querySelectorAll('img:not(.simpleUnlazy)')]
    unlazyList.map(img => img.classList.add('simpleUnlazy'))

    const imgList = unlazyList.filter(img => Math.min(img.clientWidth, img.clientHeight) >= 50)
    const listSize = imgList.length
    if (!listSize) return

    console.log('Try to unlazy image')
    console.log(`${listSize} image found`)
    const asyncList = await Promise.all(imgList.map(checkImageAttr))
    const lazyName = asyncList.filter(n => n)

    if (lazyName.length !== 0) {
      for (const name of [...new Set(lazyName)]) {
        console.log(`Unlazy ${lazyName.filter(x => x === name).length} img with ${name} attr`)
      }
    } else {
      console.log('No lazy src attribute found')
    }

    await new Promise(resolve => setTimeout(resolve, 500))
  }

  function getImageListWithoutFilter(options) {
    const imageDataList = []
    for (const img of document.getElementsByTagName('img')) {
      imageDataList.push([img.currentSrc, img])
    }

    for (const node of document.querySelectorAll('*')) {
      const bg = window.getComputedStyle(node).backgroundImage
      if (bg?.indexOf('url') === 0 && bg.indexOf('.svg') === -1) {
        imageDataList.push([bg.substring(4, bg.length - 1).replace(/['"]/g, ''), node])
      }
    }

    for (const video of document.querySelectorAll('video[poster]')) {
      imageDataList.push([video.poster, video])
    }

    const badImage = options.svgFilter ? url => url === '' || url === 'about:blank' || url.includes('.svg') : url => url === '' || url === 'about:blank'

    const uniqueImage = []
    outer: for (const img of imageDataList) {
      if (badImage(img[0])) continue outer
      for (const unique of uniqueImage) {
        if (img[0] === unique[0]) continue outer
      }
      uniqueImage.push(img)
    }

    return uniqueImage
  }
  function getImageList(options) {
    if (options.minWidth === 0 && options.minHeight === 0) {
      return getImageListWithoutFilter(options)
    }

    const imageDataList = []

    for (const img of document.getElementsByTagName('img')) {
      // only client size should be checked in order to bypass large icon or hidden image
      if ((img.clientWidth >= options.minWidth && img.clientHeight >= options.minHeight) || !img.complete) {
        imageDataList.push([img.currentSrc, img])
      }
    }

    for (const node of document.querySelectorAll('*')) {
      if (node.clientWidth < options.minWidth || node.clientHeight < options.minHeight) continue
      const bg = window.getComputedStyle(node).backgroundImage
      if (bg?.indexOf('url') === 0 && bg.indexOf('.svg') === -1) {
        imageDataList.push([bg.substring(4, bg.length - 1).replace(/['"]/g, ''), node])
      }
    }

    for (const video of document.querySelectorAll('video[poster]')) {
      if (video.clientWidth >= options.minWidth && video.clientHeight >= options.minHeight) {
        imageDataList.push([video.poster, video])
      }
    }

    const badImage = options.svgFilter ? url => url === '' || url === 'about:blank' || url.includes('.svg') : url => url === '' || url === 'about:blank'

    const uniqueImage = []
    const uniqueImageUrls = new Set()
    for (const img of imageDataList) {
      if (!badImage(img[0]) && !uniqueImageUrls.has(img[0])) {
        uniqueImageUrls.add(img[0])
        uniqueImage.push(img)
      }
    }

    return uniqueImage
  }
  async function sortImageDataList(dataList) {
    const imageDomList = []
    const iframeList = [...document.getElementsByTagName('iframe')]

    const iframeSrcList = iframeList.map(iframe => iframe.src)
    const iframeRedirectSrcList = await chrome.runtime.sendMessage({msg: 'get_redirect', data: iframeSrcList})

    for (const data of dataList) {
      if (typeof data[1] === 'string') {
        const index = iframeRedirectSrcList.indexOf(data[1])
        if (index !== -1) {
          imageDomList.push([data[0], iframeList[index]])
        }
      } else {
        imageDomList.push([...data])
      }
    }

    imageDomList.sort((a, b) => (a[1].compareDocumentPosition(b[1]) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))

    const sortedDataList = []
    for (const data of imageDomList) {
      if (data[1].tagName === 'IFRAME') {
        sortedDataList.push([data[0], data[1].src])
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
    const bg = window.getComputedStyle(dom).backgroundImage
    return bg.substring(4, bg.length - 1).replace(/['"]/g, '')
  }

  function getImageInfoIndex(array, data) {
    if (typeof data === 'string') {
      return array.indexOf(data)
    }
    for (let i = 0; i < array.length; i++) {
      if (array[i]?.[0] === data[0]) return i
    }
    return -1
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

    updateWrapperSize: function (dom, options) {
      if (!dom) return

      const domSize = Math.min(dom.clientWidth, dom.clientHeight)

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

        const maxWidth = Math.max(...imgList.map(img => img.clientWidth))
        const maxHeight = Math.max(...imgList.map(img => img.clientHeight))
        width.push(maxWidth)
        height.push(maxHeight)
      }

      const finalWidth = Math.min(...width.filter(w => w * 2 >= domSize)) - 3
      const finalHeight = Math.min(...height.filter(h => h * 2 >= domSize)) - 3

      options.minWidth = Math.min(finalWidth, options.minWidth)
      options.minHeight = Math.min(finalHeight, options.minHeight)
    },

    getOrderedImageUrls: async function (options) {
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

      if (uniqueImageUrls.length === 0) return []

      const orderedImageUrls = await sortImageDataList(uniqueImageUrls)
      return orderedImageUrls
    },

    searchImageInfoIndex: function (input, imageList) {
      if (typeof input === 'object') {
        const currentUrl = getDomUrl(input)
        return imageList.indexOf(currentUrl)
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

      return [...new Set(combinedImageList.filter(Boolean))]
    }
  }
})()
