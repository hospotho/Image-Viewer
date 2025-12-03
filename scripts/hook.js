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
  function checkCORS(image) {
    const cached = imageCORSMap.get(image.src)
    if (cached !== undefined) return cached

    if (image.crossOrigin === 'anonymous') {
      imageCORSMap.set(image.src, true)
      return false
    }

    try {
      const canvas = document.createElement('canvas')
      canvas.width = 100
      canvas.height = 100
      const ctx = canvas.getContext('2d')
      realDrawImage.apply(ctx, [image, 0, 0])
      canvas.toDataURL('image/png')
      imageCORSMap.set(image.src, false)
      return false
    } catch (error) {
      imageCORSMap.set(image.src, true)
      return true
    }
  }

  const realDrawImage = CanvasRenderingContext2D.prototype.drawImage
  CanvasRenderingContext2D.prototype.drawImage = function (...args) {
    if (args[0] instanceof HTMLImageElement && checkCORS(args[0])) {
      const result = getBase64Image(args[0].src)
      if (result instanceof HTMLImageElement) {
        args[0] = result
      } else if (result instanceof Promise) {
        result.then(image => {
          args[0] = image
          realDrawImage.apply(this, args)
        })
        return
      }
    }
    realDrawImage.apply(this, args)
  }
})()
