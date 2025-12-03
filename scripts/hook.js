;(function () {
  'use strict'

  const safeSendMessage = function (...args) {
    if (chrome.runtime?.id) {
      return chrome.runtime.sendMessage(...args)
    }
  }

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
    // wake up background
    while (true) {
      if (await safeSendMessage({msg: 'ping'})) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    const [dataUrl] = await safeSendMessage({msg: 'request_cors_url', url: src})
    return dataUrl
  }
  async function getBase64Image(image) {
    const dataUrl = await getImageDataURL(image.src)
    const dataImage = new Image()
    const result = await new Promise(resolve => {
      dataImage.onload = resolve(true)
      dataImage.onerror = resolve(false)
      dataImage.src = dataUrl
    })
    // return empty image on failure
    return result ? dataImage : new Image()
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
  CanvasRenderingContext2D.prototype.drawImage = async function (...args) {
    if (args[0] instanceof HTMLImageElement) {
      this.canvas.cors = this.canvas.cors || checkCORS(args[0])
      if (this.canvas.cors) {
        args[0] = await getBase64Image(args[0])
      }
    }
    return realDrawImage.apply(this, args)
  }
})()
