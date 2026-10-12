;(function () {
  'use strict'

  // prevent image blob revoked
  const isImageUrlMap = new Map()
  const realCreate = URL.createObjectURL
  const realRevoke = URL.revokeObjectURL
  URL.createObjectURL = function (obj) {
    const url = realCreate(obj)

    if (!(obj instanceof Blob)) {
      isImageUrlMap.set(url, false)
      return url
    }
    if (obj.type.startsWith('image/')) {
      isImageUrlMap.set(url, true)
      return url
    }
    if (obj.size > 1024 * 1024 * 5 || (obj.type !== '' && obj.type !== 'application/octet-stream')) {
      isImageUrlMap.set(url, false)
      return url
    }
    const promise = new Promise(_resolve => {
      const resolve = result => {
        _resolve(result)
        isImageUrlMap.set(url, result)
      }
      const img = new Image()
      img.onload = () => resolve(true)
      img.onerror = () => resolve(false)
      img.src = url
    })
    isImageUrlMap.set(url, promise)
    return url
  }
  URL.revokeObjectURL = async function (url) {
    const isImage = await isImageUrlMap.get(url)
    if (!isImage) realRevoke(url)
  }

  // canvas cache
  const srcBase64Map = new Map()
  const imageCORSMap = new Map()
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', {alpha: false, willReadFrequently: true})
  canvas.width = 1
  canvas.height = 1

  // prevent canvas tainted
  async function getImageDataURL(src) {
    try {
      const res = await fetch(src)
      if (res.ok) {
        const blob = await res.blob()
        const reader = new FileReader()
        const dataUrl = await new Promise(resolve => {
          reader.onload = () => resolve(reader.result)
          reader.readAsDataURL(blob)
        })
        return dataUrl
      }
    } catch (error) {}

    // only possible to communicate through DOM in MAIN world
    const {promise, resolve} = Promise.withResolvers()
    const div = document.createElement('div')
    div.id = 'iv-request-' + Math.random().toString(16).slice(2)
    div.style.display = 'none'
    div.setAttribute('iv-url', src)

    const observer = new MutationObserver(() => {
      observer.disconnect()
      resolve(div.getAttribute('iv-url'))
      document.body.removeChild(div)
    })
    observer.observe(div, {attributeFilter: ['iv-url']})
    document.body.appendChild(div)

    const dataUrl = await promise
    return dataUrl
  }
  function getBase64Image(src) {
    const cache = srcBase64Map.get(src)
    if (cache !== undefined) return cache

    const promise = new Promise(_resolve => {
      const resolve = result => {
        srcBase64Map.set(src, result)
        _resolve(result)
      }

      const dataImage = new Image()
      dataImage.onload = () => resolve(dataImage)
      dataImage.onerror = () => resolve(null)
      getImageDataURL(src).then(dataUrl => (dataImage.src = dataUrl))
    })

    srcBase64Map.set(src, promise)
    return promise
  }
  function willTaintCanvas(image) {
    const src = image.currentSrc
    const cached = imageCORSMap.get(src)
    if (cached !== undefined) return cached
    // assume crossOrigin attr consistent
    if (image.crossOrigin === 'anonymous') {
      imageCORSMap.set(src, false)
      return false
    }
    // reset tainted flag by assign canvas size
    canvas.width = 1
    realDrawImage.apply(ctx, [image, 0, 0])
    try {
      ctx.getImageData(0, 0, 1, 1)
      imageCORSMap.set(src, false)
      return false
    } catch (error) {
      imageCORSMap.set(src, true)
      return true
    }
  }

  // skip ctx.createPattern as no valid sync return value for tainted input
  const realDrawImage = CanvasRenderingContext2D.prototype.drawImage
  CanvasRenderingContext2D.prototype.drawImage = function (...args) {
    // assume only image will taint canvas
    const image = args[0]
    const isImage = image instanceof HTMLImageElement
    if (!isImage) {
      realDrawImage.apply(this, args)
      return
    }
    // skip zero size or usable current source but pending load
    if (image.naturalWidth === 0 || image.naturalHeight === 0 || !image.complete) return
    // handle normal image
    if (!willTaintCanvas(image)) {
      realDrawImage.apply(this, args)
      return
    }
    // pass cors img to hook helper
    const result = getBase64Image(image.currentSrc || image.src)
    if (result instanceof HTMLImageElement) {
      args[0] = result
      realDrawImage.apply(this, args)
      return
    }
    // assume delaying tainted draw does not matter
    if (result instanceof Promise) {
      result.then(image => {
        if (!image) return
        args[0] = image
        realDrawImage.apply(this, args)
      })
    }
  }
})()
