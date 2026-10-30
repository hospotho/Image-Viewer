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

    const {promise, resolve} = Promise.withResolvers()
    const _resolve = result => {
      resolve(result)
      isImageUrlMap.set(url, result)
    }
    isImageUrlMap.set(url, promise)

    const img = new Image()
    img.onload = () => _resolve(true)
    img.onerror = () => _resolve(false)
    img.src = url

    return url
  }
  URL.revokeObjectURL = async function (url) {
    const isImage = await isImageUrlMap.get(url)
    if (!isImage) realRevoke(url)
  }

  if (document.contentType !== 'text/html') return

  const realCall = Function.prototype.call.bind(Function.prototype.call)
  const realApply = Function.prototype.apply
  const realMapGet = Map.prototype.get
  const realMapSet = Map.prototype.set
  const realMapDelete = Map.prototype.delete
  const realFetch = window.fetch.bind(window)
  const realSetTimeout = window.setTimeout.bind(window)
  const realClearTimeout = window.clearTimeout.bind(window)
  const realDispatch = window.dispatchEvent.bind(window)
  const realParse = JSON.parse
  const realImageSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src').set
  const realEventDetail = Object.getOwnPropertyDescriptor(CustomEvent.prototype, 'detail').get
  const realReadAsDataURL = FileReader.prototype.readAsDataURL
  const realAddEventListener = EventTarget.prototype.addEventListener
  const withResolvers = Promise.withResolvers.bind(Promise)
  const realThen = Promise.prototype.then

  const RealImage = Image
  const RealPromise = Promise
  const RealFileReader = FileReader
  const RealCustomEvent = CustomEvent

  let channel = ''
  let requestId = 0
  const resolveMap = new Map()

  function sendRequest(src) {
    // prepare request promise
    const id = ++requestId
    const {promise, resolve} = withResolvers()
    const timeout = realSetTimeout(() => resolve('') || realCall(realMapDelete, resolveMap, id), 20000)
    const _resolve = result => resolve(result) || realClearTimeout(timeout) || realCall(realMapDelete, resolveMap, id)
    realCall(realMapSet, resolveMap, id, _resolve)
    // send request
    const event = new RealCustomEvent(`${channel}-request`, {detail: `[${id},"${src}"]`})
    realDispatch(event)
    return promise
  }
  function handleResponse(e) {
    const detail = realCall(realEventDetail, e)
    const [id, dataUrl] = realParse(detail)
    const resolve = realCall(realMapGet, resolveMap, id)
    if (!resolve) return
    resolve(dataUrl)
  }

  // init handoff must finish at document_start
  window.addEventListener(
    'iv-hook-init',
    e => {
      const eventChannel = e.detail
      if (typeof eventChannel !== 'string' || !/^iv-hook-[0-9a-f]{32}$/.test(eventChannel)) return
      channel = eventChannel
      window.addEventListener(`${channel}-response`, handleResponse)
      e.preventDefault()
    },
    {once: true}
  )

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
      const res = await realFetch(src)
      if (res.ok) {
        const blob = await res.blob()
        const reader = new RealFileReader()
        const dataUrl = await new RealPromise(resolve => {
          reader.onload = () => resolve(reader.result)
          reader.onerror = () => resolve('')
          realCall(realReadAsDataURL, reader, blob)
        })
        return dataUrl
      }
    } catch (error) {}

    // communicate through secret channel
    const dataUrl = await sendRequest(src)
    return dataUrl
  }
  function getBase64Image(src) {
    const cache = realCall(realMapGet, srcBase64Map, src)
    if (cache !== undefined) return cache

    const promise = new RealPromise(_resolve => {
      const resolve = result => {
        realCall(realMapSet, srcBase64Map, src, result)
        _resolve(result)
      }

      const dataImage = new RealImage()
      realCall(realAddEventListener, dataImage, 'load', () => resolve(dataImage))
      realCall(realAddEventListener, dataImage, 'error', () => resolve(null))
      realCall(realThen, getImageDataURL(src), dataUrl => realCall(realImageSrc, dataImage, dataUrl))
    })

    realCall(realMapSet, srcBase64Map, src, promise)
    return promise
  }
  function willTaintCanvas(image) {
    const src = image.currentSrc
    const cached = realCall(realMapGet, imageCORSMap, src)
    if (cached !== undefined) return cached
    // assume crossOrigin attr consistent
    if (image.crossOrigin === 'anonymous') {
      realCall(realMapSet, imageCORSMap, src, false)
      return false
    }
    // reset tainted flag by assign canvas size
    canvas.width = 1
    realCall(realApply, realDrawImage, ctx, [image, 0, 0])
    try {
      ctx.getImageData(0, 0, 1, 1)
      realCall(realMapSet, imageCORSMap, src, false)
      return false
    } catch (error) {
      realCall(realMapSet, imageCORSMap, src, true)
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
      realCall(realApply, realDrawImage, this, args)
      return
    }
    // skip zero size or usable current source but pending load
    if (image.naturalWidth === 0 || image.naturalHeight === 0 || !image.complete) return
    // handle normal image
    if (!willTaintCanvas(image)) {
      realCall(realApply, realDrawImage, this, args)
      return
    }
    // pass cors img to hook helper
    const result = getBase64Image(image.currentSrc || image.src)
    if (result instanceof RealImage) {
      args[0] = result
      realCall(realApply, realDrawImage, this, args)
      return
    }
    // assume delaying tainted draw does not matter
    if (result instanceof RealPromise) {
      realCall(realThen, result, image => {
        if (!image) return
        args[0] = image
        realCall(realApply, realDrawImage, this, args)
      })
    }
  }
})()
