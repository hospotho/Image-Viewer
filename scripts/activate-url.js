;(function () {
  'use strict'

  const safeSendMessage = function (...args) {
    if (chrome.runtime?.id) {
      return chrome.runtime.sendMessage(...args)
    }
  }

  async function loadOptions() {
    await safeSendMessage('get_options')
    // chrome may terminated service worker
    while (!window.ImageViewerOption) {
      await new Promise(resolve => setTimeout(resolve, 50))
      await safeSendMessage('get_options')
    }
  }

  // image url mode
  function isImageContained(small, large) {
    const canvas1 = document.createElement('canvas')
    const canvas2 = document.createElement('canvas')
    const ctx1 = canvas1.getContext('2d')
    const ctx2 = canvas2.getContext('2d', {willReadFrequently: true})

    // pooling
    const poolingWidth = 256
    const smallRatio = small.width / small.height
    const largeRatio = large.width / large.height

    canvas1.width = poolingWidth
    canvas1.height = poolingWidth / smallRatio
    ctx1.drawImage(small, 0, 0, small.width, small.height, 0, 0, poolingWidth, canvas1.height)

    canvas2.width = poolingWidth
    canvas2.height = poolingWidth / largeRatio
    ctx2.drawImage(large, 0, 0, large.width, large.height, 0, 0, poolingWidth, canvas2.height)

    // compare pixels
    const threshold = 0.5
    const base = ctx1.getImageData(0, 0, poolingWidth, canvas1.height).data
    const pixelCount = base.length / 4

    // check if center
    let diffCount = 0
    const center = ctx2.getImageData(0, (canvas2.height - canvas1.height) / 2, poolingWidth, canvas1.height).data
    for (let i = 0; i < base.length; i += 4) {
      if (Math.abs(base[i] - center[i]) + Math.abs(base[i + 1] - center[i + 1]) + Math.abs(base[i + 2] - center[i + 2]) > 24) {
        diffCount++
      }
    }
    if (diffCount / pixelCount < threshold) return true

    // check if topmost
    diffCount = 0
    const top = ctx2.getImageData(0, 0, poolingWidth, canvas1.height).data
    for (let i = 0; i < base.length; i += 4) {
      if (Math.abs(base[i] - top[i]) + Math.abs(base[i + 1] - top[i + 1]) + Math.abs(base[i + 2] - top[i + 2]) > 24) {
        diffCount++
      }
    }
    if (diffCount / pixelCount < threshold) return true

    return false
  }

  const argsRegex = /(.*?[=.](?:jpeg|jpg|png|gif|webp|bmp|tiff|avif))(?!\/)/i
  function getRawUrl(src) {
    if (src.startsWith('data') || src.startsWith('blob')) return src

    const filenameMatch = src.replace(/[-_]\d{3,4}x(?:\d{3,4})?\./, '.')
    if (filenameMatch !== src) return filenameMatch

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
      const rawSearch = baseURI + imgSearch

      const argsMatch = rawSearch.match(argsRegex)
      if (argsMatch) {
        const rawUrl = argsMatch[1]
        if (rawUrl !== src) return rawUrl
      }
    } catch (error) {}

    const argsMatch = src.match(argsRegex)
    if (argsMatch) {
      const rawUrl = argsMatch[1]
      if (rawUrl !== src) return rawUrl
    }
    return src
  }
  function getImage(rawUrl) {
    return new Promise(resolve => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => resolve(img)
      img.src = rawUrl
    })
  }
  function getUnlazyAttrList(img) {
    const src = img.currentSrc
    const rawUrl = getRawUrl(src)
    const attrList = []
    attrList.push({name: 'raw url', value: rawUrl})
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
    return attrList.filter(attr => attr.value !== src)
  }

  async function initImageViewer(image) {
    console.log('Start image mode')

    // remove default image css
    image.style = ''
    image.style.margin = 'auto'
    image.style.backgroundColor = 'rgb(0, 0, 0)'

    await loadOptions()
    await safeSendMessage('load_script')

    const options = window.ImageViewerOption
    options.closeButton = false
    options.minWidth = 0
    options.minHeight = 0

    const imageDate = {src: image.src, dom: image}
    ImageViewer([imageDate], options)

    if (image.src.startsWith('data')) return

    const attrList = getUnlazyAttrList(image)
    for (const attr of attrList) {
      const rawImage = await getImage(attr.value)
      const rawSize = [rawImage.naturalWidth, rawImage.naturalHeight]
      if (image.naturalWidth > rawSize[0]) continue
      const rawRatio = rawSize[0] / rawSize[1]
      const currRatio = image.naturalWidth / image.naturalHeight
      // non trivial size or with proper ratio
      const nonTrivialSize = rawSize[0] % 10 || rawSize[1] % 10
      const properRatio = currRatio === 1 || Math.abs(rawRatio - currRatio) < 0.01 || rawRatio > 3 || rawRatio < 1 / 3
      const isRawCandidate = nonTrivialSize || properRatio
      if (isRawCandidate) {
        console.log(`Unlazy img with ${attr.name}`)
        const rawData = {src: attr.value, dom: image}
        ImageViewer([rawData], options)
        break
      }
      // sub image
      if (image.naturalWidth >= 256 && rawRatio < currRatio && isImageContained(image, rawImage)) {
        console.log(`Unlazy img with ${attr.name}`)
        const rawData = {src: attr.value, dom: image}
        ImageViewer([rawData], options)
        break
      }
    }
  }

  async function init() {
    // safe to send message in iframe
    if (window.top !== window.self) {
      safeSendMessage('load_extractor')
      return
    }

    try {
      const image = document.querySelector(`img[src='${location.href}']`)
      const found = image && (image.parentElement === document.body || (await fetch(location.href).then(res => res.headers.get('Content-Type')?.startsWith('image/'))))
      if (found) {
        initImageViewer(image)
        return
      }
    } catch (error) {}

    await loadOptions()
    safeSendMessage('load_worker')
  }

  if (document.visibilityState === 'visible') {
    init()
  } else {
    const handleEvent = () => {
      document.removeEventListener('visibilitychange', handleEvent)
      window.removeEventListener('focus', handleEvent)
      init()
    }
    document.addEventListener('visibilitychange', handleEvent)
    window.addEventListener('focus', handleEvent)
  }
})()
